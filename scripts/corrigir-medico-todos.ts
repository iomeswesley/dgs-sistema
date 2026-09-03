/*
  Correção pontual (2026-09-03): reatribui pro médico certo os agendamentos
  que a extração jogou sob o médico "Todos" (id 8) — achado numa
  investigação pedida pelo usuário depois do cliente notar "confirmados
  diminuídos" nas agendas do Reinaldo e do Mariston pra 04/09. Causa real:
  o PDF de origem trazia "Profissional Executante: Todos" no cabeçalho (a
  secretaria gerou sem filtrar por médico), e o sistema sempre confia nesse
  texto pra achar/criar o médico do agendamento — mesmo quando a lista já
  está vinculada a uma Agenda com o médico certo escolhido. Nenhum dado foi
  perdido: os agendamentos e confirmações sempre existiram, só ficaram
  arquivados sob o médico errado, invisíveis em qualquer tela filtrada por
  médico. Ver CLAUDE.md / memória do Claude pro relato completo.

  Escopo: só as 2 listas identificadas na investigação (41 -> Reinaldo,
  36 -> Mariston) — cada uma associada a exatamente 1 Agenda, então o
  médico certo é inequívoco. Não mexe em nenhuma outra lista com
  doctorId=8 (há mais, ~708 agendamentos históricos) — essas ficam pra uma
  auditoria separada, não decidida ainda.

    npx tsx --env-file=.env scripts/corrigir-medico-todos.ts
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { recordAudit } from "../src/modules/audit/audit.service.js";

const FIXES: { listId: number; wrongDoctorId: number; correctDoctorId: number; correctDoctorLabel: string }[] = [
  { listId: 41, wrongDoctorId: 8, correctDoctorId: 7, correctDoctorLabel: "REINALDO UGRINOVICH" },
  { listId: 36, wrongDoctorId: 8, correctDoctorId: 9, correctDoctorLabel: "MARISTON RAFAEL ALVES" },
];

async function main() {
  // Cliente "DGS" — único existente hoje (ver CLAUDE.md, multi-cliente).
  await runWithClient(1, async () => {
    for (const fix of FIXES) {
      const affected = await prisma.appointment.findMany({
        where: { listId: fix.listId, doctorId: fix.wrongDoctorId },
        select: { id: true, status: true },
      });
      if (affected.length === 0) {
        console.log(`Lista ${fix.listId}: nada pra corrigir (0 agendamentos sob doctorId=${fix.wrongDoctorId}).`);
        continue;
      }

      const byStatus: Record<string, number> = {};
      for (const a of affected) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;

      const result = await prisma.appointment.updateMany({
        where: { listId: fix.listId, doctorId: fix.wrongDoctorId },
        data: { doctorId: fix.correctDoctorId },
      });

      await recordAudit({
        userId: null, // correção via script, não por um usuário logado — ver `field` abaixo
        action: "fix_doctor_assignment",
        entity: "List",
        entityId: fix.listId,
        field: "doctorId",
        oldValue: fix.wrongDoctorId,
        newValue: fix.correctDoctorId,
        metadata: {
          reason: 'PDF de origem trazia "Profissional Executante: Todos" no cabeçalho — agendamentos ficaram sob o médico placeholder "Todos" em vez do médico da Agenda vinculada.',
          appointmentsFixed: result.count,
          statusBreakdown: byStatus,
          correctDoctor: fix.correctDoctorLabel,
        },
      });

      console.log(
        `Lista ${fix.listId}: ${result.count} agendamentos reatribuídos de "Todos" pra ${fix.correctDoctorLabel}. Status: ${JSON.stringify(byStatus)}`
      );
    }
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
