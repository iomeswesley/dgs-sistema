/*
  Auditoria completa (2026-09-03) de agendamentos cuja resposta real do
  paciente nunca aplicou no status — dois bugs de raiz corrigidos no mesmo
  dia (whatsapp.service.ts):

  1. Corrida entre o evento de entrega/leitura da Meta e a resposta do
     paciente chegando quase juntos — o evento de entrega podia sobrescrever
     "Entregue" por cima de uma confirmação/recusa já processada, com dado
     velho (sem transação nem condição no UPDATE). Caso real: Gisele
     Padilha respondeu "Sim" por texto livre, ficou provado que o sistema
     processou (respondedAt bate certinho), mas a lista mostrava só
     "Entregue".
  2. `findAppointmentForPhone()` só casava pelo `selectedPhone` atual —
     quando o reenvio automático (`enqueueRetries()`, telefone alternativo)
     manda pra um número novo sem atualizar esse campo, a resposta que
     vem desse número novo não achava agendamento nenhum pra vincular.
     Caso real: Juliete Caetano respondeu "Não poderei ir" do número pro
     qual o reenvio automático tinha mandado; ficou sem aplicar.

  Este script varre TODO agendamento ainda "aberto" (ENVIADO/ENTREGUE/
  FALHA/SEM_RESPOSTA — CONFIRMADO/RECUSADO já é resolvido, não mexe) e
  procura, entre as mensagens RECEBIDAS de qualquer telefone já tentado
  pra esse agendamento (mesmo escopo que os 2 bugs corrigidos cobrem
  agora), a última classificável como confirmação/recusa depois do
  primeiro envio — e corrige o status pra bater com ela. "Última resposta
  vence" (pedido explícito do usuário), mesma regra do código já corrigido.

    npx tsx --env-file=.env scripts/auditar-respostas-perdidas.ts           # dry-run
    npx tsx --env-file=.env scripts/auditar-respostas-perdidas.ts --apply   # aplica
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { recordAudit } from "../src/modules/audit/audit.service.js";
import { classifyReply } from "../src/lib/templates.js";
import { phoneCandidates } from "../src/lib/phone.js";

const APPLY = process.argv.includes("--apply");
const OPEN_STATUSES = ["ENVIADO", "ENTREGUE", "FALHA", "SEM_RESPOSTA"] as const;

async function main() {
  await runWithClient(1, async () => {
    const appointments = await prisma.appointment.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      select: {
        id: true,
        status: true,
        phones: true,
        selectedPhone: true,
        patient: { select: { name: true } },
      },
    });
    console.log(`Agendamentos "abertos" pra conferir: ${appointments.length}`);

    let fixed = 0;
    let checked = 0;

    for (const appointment of appointments) {
      const candidatePhones = [...new Set(appointment.phones.flatMap((p) => phoneCandidates(p)))];
      if (candidatePhones.length === 0) continue;

      const firstSent = await prisma.whatsappMessage.findFirst({
        where: { appointmentId: appointment.id, direction: "ENVIADA" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      if (!firstSent) continue; // nunca enviou nada — nada a checar

      const replies = await prisma.whatsappMessage.findMany({
        where: {
          direction: "RECEBIDA",
          phone: { in: candidatePhones },
          createdAt: { gte: firstSent.createdAt },
        },
        orderBy: { createdAt: "asc" },
        select: { body: true, buttonPayload: true, createdAt: true },
      });
      checked++;
      if (replies.length === 0) continue;

      // Última resposta classificável (ignora texto livre ambíguo — não
      // chuta, mesma regra do webhook de verdade).
      let lastIntent: "confirm" | "refuse" | null = null;
      let lastAt: Date | null = null;
      for (const reply of replies) {
        const intent = classifyReply({ buttonPayload: reply.buttonPayload, text: reply.body });
        if (intent === "confirm" || intent === "refuse") {
          lastIntent = intent;
          lastAt = reply.createdAt;
        }
      }
      if (!lastIntent) continue;

      const correctStatus = lastIntent === "confirm" ? "CONFIRMADO" : "RECUSADO";
      if (appointment.status === correctStatus) continue; // já está certo

      console.log(
        `Agendamento ${appointment.id} (${appointment.patient.name}): estava "${appointment.status}", última resposta classificável = "${lastIntent}" em ${lastAt?.toISOString()} -> devia ser "${correctStatus}"`
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
              "Auditoria de respostas perdidas (2026-09-03) — resposta real do paciente nunca tinha aplicado (corrida entre eventos do webhook, ou telefone de reenvio automático não casava com selectedPhone).",
            respondedAt: lastAt,
          },
        });
      }
    }

    console.log(`\n=== Resumo ===`);
    console.log(`Agendamentos conferidos (tinham pelo menos 1 envio): ${checked}`);
    console.log(`Com resposta perdida encontrada: ${fixed}`);
    console.log(APPLY ? "Aplicado." : "DRY-RUN — nada foi alterado. Rode com --apply pra aplicar.");
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
