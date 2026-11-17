/*
  Cadastro de um cliente novo a partir da ficha de onboarding (2026-11-17,
  primeiro uso: Botuverá). Lê um JSON (ex.: scripts/onboarding/botuvera.json)
  e deixa o cliente pronto pra usar:

    1. cliente + AppSettings (módulos, fluxo de mensagem, nome do remetente)
    2. município, unidades (com endereço), médicos e procedimentos
    3. logins da equipe do cliente (senha gerada, aparece UMA vez no fim)
       + acesso dos super admins ao cliente novo
    4. conta de WhatsApp: move a conta existente pro cliente e deixa ativa

  Idempotente: o que já existe é reaproveitado (nunca troca senha de quem já
  tem login). Sem --apply só mostra o que faria.

    npx tsx --env-file=.env scripts/onboarding-cliente.ts scripts/onboarding/botuvera.json
    npx tsx --env-file=.env scripts/onboarding-cliente.ts scripts/onboarding/botuvera.json --apply

  --meta (depois do --apply): confere na Meta se a conta do cliente consegue
  enviar (health_status) e acerta os templates dele — submete os que faltam e
  edita os que ainda estão com o texto da DGS pro nome do remetente. Template
  editado volta pra análise da Meta (~24h).

    npx tsx --env-file=.env scripts/onboarding-cliente.ts scripts/onboarding/botuvera.json --meta
*/
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { runAsSuperAdmin, runWithClient } from "../src/lib/tenant-context.js";
import { generateRandomPassword, hashPassword } from "../src/lib/auth.js";
import { normalizePhone } from "../src/lib/phone.js";
import {
  brandTemplates,
  DEFAULT_TEMPLATES,
  editTemplates,
  getTemplateStatuses,
  submitTemplates,
} from "../src/lib/whatsapp-templates.js";

interface OnboardingFile {
  client: { name: string; notes?: string };
  features: {
    messageFlow: "CONFIRMACAO" | "OFERTA" | "AMBOS";
    senderName: string | null;
    moduleLembrete: boolean;
    moduleCancelamento: boolean;
  };
  municipality: { name: string; state: string };
  units: { name: string; address: string | null }[];
  users: { name: string; email: string }[];
  doctors?: { name: string; title?: "Dr." | "Dra." | null; phone?: string | null; specialty?: string | null }[];
  procedures?: { name: string; preparationInstructions?: string | null }[];
  whatsappAccountId?: number | null;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const META = args.includes("--meta");
if (!file) throw new Error("Informe o arquivo JSON da ficha.");
const data = JSON.parse(readFileSync(file, "utf8")) as OnboardingFile;

const GRAPH = "https://graph.facebook.com/v21.0";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function step(message: string) {
  console.log(`${APPLY ? "✔" : "·"} ${message}`);
}

async function audit(clientId: number, action: string, entity: string, entityId: number | null, newValue?: string) {
  if (!APPLY) return;
  await prisma.auditLog.create({ data: { clientId, action, entity, entityId, newValue: newValue ?? null } });
}

async function onboard() {
  const passwords: { name: string; email: string; password: string }[] = [];

  await runAsSuperAdmin(async () => {
    // 1. Cliente + configurações
    let client = await prisma.client.findUnique({ where: { name: data.client.name } });
    if (client) {
      step(`Cliente "${client.name}" já existe (id ${client.id}) — reaproveitado.`);
    } else if (APPLY) {
      client = await prisma.$transaction(async (tx) => {
        const created = await tx.client.create({ data: { name: data.client.name, notes: data.client.notes ?? null } });
        await tx.appSettings.create({ data: { clientId: created.id } });
        return created;
      });
      await audit(client.id, "admin.create_client", "Client", client.id, client.name);
      step(`Cliente "${client.name}" criado (id ${client.id}).`);
    } else {
      step(`Criaria o cliente "${data.client.name}".`);
    }
    const clientId = client?.id ?? -1;

    if (data.features.senderName && data.features.senderName.length > 60) {
      throw new Error("senderName passa de 60 caracteres (limite do rodapé do template na Meta).");
    }
    if (APPLY) {
      await prisma.appSettings.update({ where: { clientId }, data: data.features });
      await audit(clientId, "admin.edit_client_features", "AppSettings", null, JSON.stringify(data.features));
    }
    step(
      `Módulos: fluxo ${data.features.messageFlow}, remetente "${data.features.senderName ?? "DGS"}", ` +
        `lembrete ${data.features.moduleLembrete ? "ligado" : "desligado"}, cancelamento ${data.features.moduleCancelamento ? "ligado" : "desligado"}.`
    );

    // 2. Cadastro
    let municipality = client
      ? await prisma.municipality.findFirst({ where: { clientId, name: data.municipality.name } })
      : null;
    if (municipality) {
      step(`Município ${municipality.name} já cadastrado.`);
    } else if (APPLY) {
      municipality = await prisma.municipality.create({ data: { clientId, ...data.municipality } });
      await audit(clientId, "create", "Municipality", municipality.id, municipality.name);
      step(`Município ${municipality.name}/${municipality.state} cadastrado.`);
    } else {
      step(`Cadastraria o município ${data.municipality.name}/${data.municipality.state}.`);
    }

    for (const unit of data.units) {
      const existing = municipality
        ? await prisma.healthUnit.findFirst({ where: { clientId, municipalityId: municipality.id, name: unit.name } })
        : null;
      if (existing) {
        if (unit.address && existing.address !== unit.address && APPLY) {
          await prisma.healthUnit.update({ where: { id: existing.id }, data: { address: unit.address } });
        }
        step(`Unidade ${unit.name} já cadastrada${unit.address && existing.address !== unit.address ? " — endereço atualizado" : ""}.`);
      } else if (APPLY && municipality) {
        const created = await prisma.healthUnit.create({
          data: { clientId, municipalityId: municipality.id, name: unit.name, address: unit.address },
        });
        await audit(clientId, "create", "HealthUnit", created.id, `${unit.name} — ${unit.address ?? ""}`);
        step(`Unidade ${unit.name} (${unit.address ?? "sem endereço"}) cadastrada.`);
      } else {
        step(`Cadastraria a unidade ${unit.name} (${unit.address ?? "sem endereço"}).`);
      }
    }

    for (const doctor of data.doctors ?? []) {
      const phone = doctor.phone ? normalizePhone(doctor.phone) : null;
      if (doctor.phone && phone?.kind !== "mobile") throw new Error(`Celular inválido pro médico ${doctor.name}: ${doctor.phone}`);
      const existing = client ? await prisma.doctor.findFirst({ where: { clientId, name: doctor.name } }) : null;
      if (existing) {
        step(`Médico ${doctor.name} já cadastrado.`);
      } else if (APPLY) {
        const created = await prisma.doctor.create({
          data: { clientId, name: doctor.name, title: doctor.title ?? null, phone: phone?.e164 ?? null, specialty: doctor.specialty ?? null },
        });
        await audit(clientId, "create", "Doctor", created.id, doctor.name);
        step(`Médico ${doctor.name} cadastrado.`);
      } else {
        step(`Cadastraria o médico ${doctor.name}.`);
      }
    }

    for (const procedure of data.procedures ?? []) {
      const existing = client ? await prisma.procedure.findFirst({ where: { clientId, name: procedure.name } }) : null;
      if (existing) {
        step(`Procedimento ${procedure.name} já cadastrado.`);
      } else if (APPLY) {
        const created = await prisma.procedure.create({
          data: { clientId, name: procedure.name, preparationInstructions: procedure.preparationInstructions ?? null },
        });
        await audit(clientId, "create", "Procedure", created.id, procedure.name);
        step(`Procedimento ${procedure.name} cadastrado.`);
      } else {
        step(`Cadastraria o procedimento ${procedure.name}.`);
      }
    }

    // 3. Logins
    const emails = data.users.map((u) => u.email.toLowerCase().trim());
    if (new Set(emails).size !== emails.length) throw new Error("E-mail repetido na lista de usuários — cada e-mail é um login.");
    for (const entry of data.users) {
      const email = entry.email.toLowerCase().trim();
      let user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        step(`Login ${email} já existe (${user.name}) — senha mantida, só garante o acesso a ${data.client.name}.`);
      } else if (APPLY) {
        const password = generateRandomPassword(14);
        user = await prisma.user.create({ data: { name: entry.name, email, passwordHash: hashPassword(password) } });
        passwords.push({ name: entry.name, email, password });
        await audit(clientId, "create_user", "User", user.id, email);
        step(`Login criado: ${entry.name} <${email}>.`);
      } else {
        step(`Criaria o login ${entry.name} <${email}>.`);
      }
      if (user && APPLY && !(await prisma.userClient.findFirst({ where: { userId: user.id, clientId } }))) {
        await prisma.userClient.create({ data: { userId: user.id, clientId } });
        await audit(clientId, "admin.grant_client_access", "UserClient", user.id, email);
      }
    }

    const admins = await prisma.user.findMany({ where: { isSuperAdmin: true, active: true } });
    for (const admin of admins) {
      const has = client ? await prisma.userClient.findFirst({ where: { userId: admin.id, clientId } }) : null;
      if (!has && APPLY) {
        await prisma.userClient.create({ data: { userId: admin.id, clientId } });
        await audit(clientId, "admin.grant_client_access", "UserClient", admin.id, admin.email);
      }
      step(`Super admin ${admin.name} ${has ? "já tem" : APPLY ? "ganhou" : "ganharia"} acesso a ${data.client.name}.`);
    }

    // 4. WhatsApp
    if (data.whatsappAccountId) {
      const account = await prisma.whatsappAccount.findUnique({
        where: { id: data.whatsappAccountId },
        include: { client: { select: { name: true } } },
      });
      if (!account) throw new Error(`Conta de WhatsApp #${data.whatsappAccountId} não existe.`);
      const label = `#${account.id} (${account.businessName ?? account.label ?? account.phoneNumberId}, WABA ${account.wabaId})`;
      if (account.clientId === clientId && account.active) {
        step(`Conta ${label} já é a ativa de ${data.client.name}.`);
      } else {
        if (account.clientId !== clientId && account.active) {
          // Mover a conta ATIVA de outro cliente deixaria esse cliente sem envio.
          throw new Error(`A conta ${label} é a ativa do cliente ${account.client.name}. Ative outra conta lá antes de mover.`);
        }
        if (APPLY) {
          await prisma.$transaction([
            prisma.whatsappAccount.updateMany({ where: { clientId, active: true }, data: { active: false } }),
            prisma.whatsappAccount.update({ where: { id: account.id }, data: { clientId, active: true } }),
          ]);
          await audit(clientId, "admin.move_whatsapp_account", "WhatsappAccount", account.id, `de ${account.client.name} para ${data.client.name}`);
        }
        step(`Conta ${label}: ${APPLY ? "movida" : "seria movida"} de ${account.client.name} para ${data.client.name} e ativada.`);
      }
    }
  });

  if (passwords.length > 0) {
    console.log("\nSENHAS (aparecem só agora — repasse pessoalmente e peça pra trocar no 1º acesso, em Equipe → Trocar minha senha):");
    for (const p of passwords) console.log(`  ${p.name} <${p.email}>: ${p.password}`);
  }
  if (!APPLY) console.log("\nSimulação — nada foi gravado. Rode de novo com --apply.");
}

async function checkMeta() {
  await runAsSuperAdmin(async () => {
    const client = await prisma.client.findUnique({ where: { name: data.client.name } });
    if (!client) throw new Error("Cliente ainda não existe — rode com --apply antes.");
    const settings = await prisma.appSettings.findUnique({ where: { clientId: client.id } });
    await runWithClient(client.id, async () => {
      const account = await prisma.whatsappAccount.findFirst({ where: { active: true } });
      if (!account) throw new Error("Cliente sem conta de WhatsApp ativa.");
      const token = account.accessToken;

      const health = (await (await fetch(`${GRAPH}/${account.wabaId}?fields=name,health_status`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json()) as { name?: string; health_status?: { can_send_message?: string; entities?: unknown[] }; error?: { message?: string } };
      if (health.error) throw new Error(`Meta: ${health.error.message}`);
      console.log(`WABA ${account.wabaId} (${health.name ?? "?"}): can_send_message = ${health.health_status?.can_send_message ?? "?"}`);
      for (const entity of health.health_status?.entities ?? []) console.log("  ", JSON.stringify(entity));

      const branded = brandTemplates(DEFAULT_TEMPLATES, settings?.senderName);
      const listing = (await (await fetch(`${GRAPH}/${account.wabaId}/message_templates?fields=name,components&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json()) as { data?: { name: string; components: { type: string; text?: string }[] }[] };
      const onMeta = new Map((listing.data ?? []).map((t) => [t.name, t]));

      const missing = branded.filter((t) => !onMeta.has(t.name));
      const outdated = branded.filter((t) => {
        const current = onMeta.get(t.name);
        if (!current) return false;
        const text = (c: { type?: string; text?: string }[]) =>
          c.filter((x) => x.type === "BODY" || x.type === "FOOTER").map((x) => x.text ?? "").join("|");
        return text(current.components) !== text(t.components as { type?: string; text?: string }[]);
      });

      if (missing.length > 0) {
        console.log(`\nSubmetendo ${missing.length} template(s) que faltam: ${missing.map((t) => t.name).join(", ")}`);
        for (const r of await submitTemplates(missing, account.wabaId, token)) console.log(r.ok ? "  OK  " : "  ERRO", r.name, r.detail ?? "");
      }
      if (outdated.length > 0) {
        console.log(`\nAcertando o remetente em ${outdated.length} template(s): ${outdated.map((t) => t.name).join(", ")}`);
        for (const r of await editTemplates(outdated, account.wabaId, token)) console.log(r.ok ? "  OK  " : "  ERRO", r.name, r.detail ?? "");
      }
      if (missing.length === 0 && outdated.length === 0) console.log("\nTemplates já estão todos lá, com o remetente certo.");

      console.log("\nStatus agora:");
      for (const s of await getTemplateStatuses(account.wabaId, token)) console.log(`  ${s.name}: ${s.status}`);
    });
  });
}

(META ? checkMeta() : onboard())
  .catch((err) => {
    console.error("ERRO:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
