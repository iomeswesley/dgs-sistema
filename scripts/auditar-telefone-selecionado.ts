/*
  Auditoria (2026-09-03) de `Appointment.selectedPhone` desatualizado —
  achado pelo usuário: clicar no nome da Juliete Caetano em Revisão abria a
  conversa do número que FALHOU, não do número novo que o reenvio
  automático usou com sucesso (e que ela respondeu). Causa: processQueue()
  nunca sincronizava `selectedPhone` com o telefone de verdade usado no
  envio — só corrigido agora (queue.service.ts). Isso protegia só envios
  NOVOS, dali pra frente; esta auditoria corrige o que já ficou
  desatualizado.

  Pra cada agendamento, acha o envio bem-sucedido (ENVIADO/ENTREGUE/LIDO)
  mais recente e, se o telefone dele for diferente do `selectedPhone`
  atual, corrige — é sempre inequívoco (o telefone de verdade usado no
  último envio que funcionou é o telefone certo pra conversa).

    npx tsx --env-file=.env scripts/auditar-telefone-selecionado.ts           # dry-run
    npx tsx --env-file=.env scripts/auditar-telefone-selecionado.ts --apply   # aplica
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { recordAudit } from "../src/modules/audit/audit.service.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  await runWithClient(1, async () => {
    const appointments = await prisma.appointment.findMany({
      where: { selectedPhone: { not: null }, status: { not: "CANCELADO" } },
      select: { id: true, selectedPhone: true, patient: { select: { name: true } } },
    });
    console.log(`Agendamentos com telefone selecionado a conferir: ${appointments.length}`);

    let fixed = 0;
    for (const appointment of appointments) {
      const lastSuccess = await prisma.whatsappMessage.findFirst({
        where: {
          appointmentId: appointment.id,
          direction: "ENVIADA",
          status: { in: ["ENVIADO", "ENTREGUE", "LIDO"] },
        },
        orderBy: { createdAt: "desc" },
        select: { phone: true, createdAt: true },
      });
      if (!lastSuccess || lastSuccess.phone === appointment.selectedPhone) continue;

      console.log(
        `Agendamento ${appointment.id} (${appointment.patient.name}): selectedPhone="${appointment.selectedPhone}", último envio bem-sucedido foi pra "${lastSuccess.phone}" em ${lastSuccess.createdAt.toISOString()} -> corrigindo`
      );
      fixed++;

      if (APPLY) {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { selectedPhone: lastSuccess.phone },
        });
        await recordAudit({
          userId: null,
          action: "fix_selected_phone",
          entity: "Appointment",
          entityId: appointment.id,
          field: "selectedPhone",
          oldValue: appointment.selectedPhone,
          newValue: lastSuccess.phone,
          metadata: {
            reason:
              "Auditoria de telefone selecionado desatualizado (2026-09-03) — processQueue() não sincronizava selectedPhone com o telefone de verdade usado no reenvio automático.",
          },
        });
      }
    }

    console.log(`\n=== Resumo ===`);
    console.log(`Corrigidos: ${fixed}`);
    console.log(APPLY ? "Aplicado." : "DRY-RUN — nada foi alterado. Rode com --apply pra aplicar.");
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
