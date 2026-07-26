/*
  Exportação mínima de dados de UM paciente, pra atender solicitação pontual
  de autoridade pública (ou do próprio titular, LGPD art. 18) sem precisar
  abrir acesso à base inteira.

  Por padrão traz só o essencial pra identificar o paciente e os
  agendamentos — nada de nota interna da equipe (contactNote), confiança da
  extração, linha bruta do arquivo, nem conteúdo de mensagem. Cada camada
  extra é opt-in, então quem roda decide conscientemente ampliar o escopo
  em vez de já vir tudo por padrão.

  Uso:
    npx tsx --env-file=.env scripts/exportar-dados-paciente.ts --cns=123456789012345
    npx tsx --env-file=.env scripts/exportar-dados-paciente.ts --telefone=5547999998888
    npx tsx --env-file=.env scripts/exportar-dados-paciente.ts --nome="Arthur Miguel"
    npx tsx --env-file=.env scripts/exportar-dados-paciente.ts --cns=... --incluir-mensagens
*/
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? "true"];
    })
  );
  return {
    cns: args.cns as string | undefined,
    telefone: args.telefone as string | undefined,
    nome: args.nome as string | undefined,
    incluirMensagens: args["incluir-mensagens"] === "true",
  };
}

async function main() {
  const { cns, telefone, nome, incluirMensagens } = parseArgs();

  if (!cns && !telefone && !nome) {
    console.error("Informe --cns=, --telefone= ou --nome= pra localizar o paciente.");
    process.exit(1);
  }

  const patients = await prisma.patient.findMany({
    where: {
      ...(cns ? { cns } : {}),
      ...(telefone ? { phones: { has: telefone } } : {}),
      ...(nome ? { name: { contains: nome, mode: "insensitive" } } : {}),
    },
  });

  if (patients.length === 0) {
    console.log("Nenhum paciente encontrado com esses critérios.");
    return;
  }
  if (patients.length > 1) {
    console.log(`${patients.length} pacientes encontrados — refine a busca (ex.: use --cns) antes de exportar.`);
    patients.forEach((p) => console.log(`- ${p.name} (id ${p.id})`));
    return;
  }

  const patient = patients[0]!;

  const appointments = await prisma.appointment.findMany({
    where: { patientId: patient.id },
    select: {
      scheduledAt: true,
      status: true,
      refusalReason: true,
      respondedAt: true,
      selectedPhone: true,
      procedure: { select: { name: true } },
      doctor: { select: { name: true } },
      municipality: { select: { name: true } },
    },
    orderBy: { scheduledAt: "desc" },
  });

  const result: Record<string, unknown> = {
    paciente: { nome: patient.name, cns: patient.cns, telefones: patient.phones, optouSair: patient.optedOut },
    agendamentos: appointments,
  };

  if (incluirMensagens) {
    result.mensagens = await prisma.whatsappMessage.findMany({
      where: { appointment: { patientId: patient.id } },
      select: { direction: true, template: true, status: true, sentAt: true, deliveredAt: true, readAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  console.log(JSON.stringify(result, null, 2));
  console.log(
    "\n--- Antes de repassar: confirme com o jurídico que o pedido é legítimo e que este é o mínimo necessário. ---"
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
