/*
  Auditoria completa (2026-09-03, v2) de agendamentos cuja resposta real do
  paciente nunca aplicou no status. Ver v1 mais acima no histórico do git
  pro relato original; esta versão (v2) varre TODO agendamento (não só os
  "abertos") atrás de mensagens RECEBIDAS que nunca conseguiram se vincular
  (`appointmentId: null` — prova concreta do bug, não achismo de
  classificação solta).

  Revisão manual (2026-09-03, junto com o usuário, olhando a lista do
  Mariston e depois o sistema inteiro): confirmação/recusa por CLIQUE DE
  BOTÃO ou frase explícita ("Sim, vou comparecer", "Não poderei ir",
  "Confirmado[, estarei lá]") é sempre segura de aplicar sozinha. Palavra
  solta e fraca ("Ok", "Sim" sem mais nada) NÃO é — 3 casos reais achados
  onde "Ok" era só reconhecimento de uma explicação da equipe (ex.:
  "reagendamento só na UBS" -> "Ok"), nunca uma reversão da decisão
  original. Por isso `isHighConfidence` abaixo exige texto com pelo menos
  2 palavras reconhecíveis (ou vier de clique de botão, que é sempre
  confiável) — só sinal fraco isolado fica de fora do --apply automático,
  listado à parte pra revisão manual.

    npx tsx --env-file=.env scripts/auditar-respostas-perdidas.ts           # dry-run
    npx tsx --env-file=.env scripts/auditar-respostas-perdidas.ts --apply   # aplica só os de alta confiança
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { recordAudit } from "../src/modules/audit/audit.service.js";
import { classifyReply } from "../src/lib/templates.js";
import { phoneCandidates } from "../src/lib/phone.js";

const APPLY = process.argv.includes("--apply");

// Revisados manualmente em 2026-09-03 (lidas as conversas inteiras, não só
// a última frase) e confirmados como falso positivo do classificador —
// nunca aplicar sozinho, mesmo passando no filtro de confiança abaixo:
//   2367 Everson Machado — número de contato é da mãe, mensagens trocadas
//     são sobre "é meu filho, não eu" + confusão de identidade, não uma
//     confirmação de verdade; fica pra revisão humana.
//   1109 Angela Ribeiro Leite — "Ok" reconhecendo "reagendamento só na
//     UBS", não uma reversão do "Não poderei ir" que ela já tinha clicado.
//   1910 Jane de Souza Silva — "Ok" um segundo depois do próprio "Não
//     poderei ir" dela, mesмо padrão.
//   2096 João Augusto Viana Neto — "Vou ver aqui" é sobre achar o telefone
//     da policlínica pra REMARCAR, não sobre confirmar a consulta original
//     (a esposa dele pediu remarcação pra 12 dias depois na mesma conversa).
const MANUALLY_EXCLUDED_IDS = new Set([2367, 1109, 1910, 2096]);

// "ok"/"sim"/"vou" sozinho (ou com pontuação/emoji em volta) não é confiável
// o bastante pra reverter status sozinho — precisa vir de botão, ou ter
// mais substância que isso.
function isHighConfidence(buttonPayload: string | null, text: string | null): boolean {
  if (buttonPayload) return true;
  if (!text) return false;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length >= 2;
}

async function main() {
  await runWithClient(1, async () => {
    const appointments = await prisma.appointment.findMany({
      where: { status: { not: "CANCELADO" } },
      select: { id: true, status: true, phones: true, patient: { select: { name: true } } },
    });
    console.log(`Agendamentos a conferir (todo status, exceto Cancelado): ${appointments.length}`);

    let checked = 0;
    let fixed = 0;
    let lowConfidence = 0;

    for (const appointment of appointments) {
      const candidatePhones = [...new Set(appointment.phones.flatMap((p) => phoneCandidates(p)))];
      if (candidatePhones.length === 0) continue;

      const firstSent = await prisma.whatsappMessage.findFirst({
        where: { appointmentId: appointment.id, direction: "ENVIADA" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      if (!firstSent) continue;

      const orphanReplies = await prisma.whatsappMessage.findMany({
        where: {
          direction: "RECEBIDA",
          phone: { in: candidatePhones },
          appointmentId: null,
          createdAt: { gte: firstSent.createdAt },
        },
        orderBy: { createdAt: "asc" },
        select: { body: true, buttonPayload: true, createdAt: true },
      });
      checked++;
      if (orphanReplies.length === 0) continue;

      let lastIntent: "confirm" | "refuse" | null = null;
      let lastText: string | null = null;
      let lastAt: Date | null = null;
      let lastHighConfidence = false;
      for (const reply of orphanReplies) {
        const intent = classifyReply({ buttonPayload: reply.buttonPayload, text: reply.body });
        if (intent === "confirm" || intent === "refuse") {
          lastIntent = intent;
          lastText = reply.buttonPayload ?? reply.body;
          lastAt = reply.createdAt;
          lastHighConfidence = isHighConfidence(reply.buttonPayload, reply.body);
        }
      }
      if (!lastIntent || !lastAt) continue;

      const correctStatus = lastIntent === "confirm" ? "CONFIRMADO" : "RECUSADO";
      if (appointment.status === correctStatus) continue;

      if (MANUALLY_EXCLUDED_IDS.has(appointment.id)) {
        console.log(
          `[REVISADO NA MÃO, excluído de propósito] Agendamento ${appointment.id} (${appointment.patient.name}) — ver comentário no topo do script.`
        );
        continue;
      }

      if (!lastHighConfidence) {
        console.log(
          `[BAIXA CONFIANÇA, NÃO aplicado automaticamente] Agendamento ${appointment.id} (${appointment.patient.name}): estava "${appointment.status}", sinal fraco = "${lastText}" em ${lastAt.toISOString()} -> reveja na mão`
        );
        lowConfidence++;
        continue;
      }

      console.log(
        `Agendamento ${appointment.id} (${appointment.patient.name}): estava "${appointment.status}", mensagem NUNCA vinculada = "${lastText}" em ${lastAt.toISOString()} -> devia ser "${correctStatus}"`
      );
      fixed++;

      if (APPLY) {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { status: correctStatus, respondedAt: lastAt },
        });
        await recordAudit({
          userId: null,
          action: "fix_lost_reply",
          entity: "Appointment",
          entityId: appointment.id,
          field: "status",
          oldValue: appointment.status,
          newValue: correctStatus,
          metadata: {
            reason:
              "Auditoria de respostas perdidas v2 (2026-09-03) — mensagem RECEBIDA nunca conseguiu se vincular ao agendamento (appointmentId nulo), mesmo já tendo status anterior. Sinal de alta confiança (botão ou frase com 2+ palavras).",
            respondedAt: lastAt,
            replyText: lastText,
          },
        });
      }
    }

    console.log(`\n=== Resumo ===`);
    console.log(`Agendamentos conferidos: ${checked}`);
    console.log(`Corrigidos (alta confiança): ${fixed}`);
    console.log(`Baixa confiança, deixados pra revisão manual: ${lowConfidence}`);
    console.log(APPLY ? "Aplicado." : "DRY-RUN — nada foi alterado. Rode com --apply pra aplicar.");
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
