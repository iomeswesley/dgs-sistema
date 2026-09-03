/*
  Auditoria completa (2026-09-03) do médico placeholder "Todos" (doctorId
  8, criado em 25/08) — sequência ao caso pontual já corrigido em
  scripts/corrigir-medico-todos.ts (listas 41 e 36). Ver CLAUDE.md /
  memória bug-medico-todos-2026-09-03 pro relato completo do bug: PDF de
  origem sem médico específico no cabeçalho ("Profissional Executante:
  Todos") fazia o sistema criar/atribuir esse médico genérico a TODO
  agendamento daquela lista, mesmo quando a lista já estava vinculada a uma
  Agenda com médico certo escolhido — escondendo confirmações de quem
  filtra por médico.

  Esta versão cobre TODAS as listas com agendamento sob doctorId=8, não só
  as 2 do caso relatado:
    - Lista COM Agenda vinculada: o médico certo é inequívoco (o da
      Agenda) — reatribui automaticamente, registra AuditLog por lista.
    - Lista SEM Agenda vinculada: não há como saber o médico certo sem
      julgamento humano (lista pode legitimamente ter vários médicos, ex.:
      cancelamento avulso) — NÃO mexe, só reporta pra decisão manual.

    npx tsx --env-file=.env scripts/auditar-medico-todos.ts           # dry-run, só relatório
    npx tsx --env-file=.env scripts/auditar-medico-todos.ts --apply   # aplica as correções seguras
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { recordAudit } from "../src/modules/audit/audit.service.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  await runWithClient(1, async () => {
    const todos = await prisma.doctor.findUnique({ where: { id: 8 } });
    if (!todos || todos.name !== "Todos") {
      console.error('Doctor id=8 não é mais "Todos" (nome mudou ou foi removido) — abortando, checar manualmente.');
      return;
    }

    const appointments = await prisma.appointment.findMany({
      where: { doctorId: 8 },
      select: {
        id: true,
        listId: true,
        status: true,
        list: {
          select: {
            id: true,
            status: true,
            agendaId: true,
            agenda: { select: { doctorId: true, doctor: { select: { name: true } }, date: true } },
          },
        },
      },
    });

    console.log(`Total de agendamentos sob "Todos": ${appointments.length}`);

    const byList = new Map<number, typeof appointments>();
    for (const a of appointments) {
      const arr = byList.get(a.listId) ?? [];
      arr.push(a);
      byList.set(a.listId, arr);
    }
    console.log(`Distribuídas em ${byList.size} lista(s).\n`);

    let totalFixable = 0;
    let totalUnfixable = 0;
    const unfixableLists: number[] = [];

    for (const [listId, appts] of byList) {
      const list = appts[0].list;
      const byStatus: Record<string, number> = {};
      for (const a of appts) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;

      if (!list.agendaId || !list.agenda) {
        console.log(
          `Lista ${listId}: ${appts.length} agendamento(s) sob "Todos", SEM agenda vinculada — não dá pra corrigir automaticamente. Status: ${JSON.stringify(byStatus)}`
        );
        totalUnfixable += appts.length;
        unfixableLists.push(listId);
        continue;
      }

      if (list.agenda.doctorId === 8) {
        console.log(
          `Lista ${listId}: agenda vinculada TAMBÉM está com médico "Todos" (doctorId 8) — nada a corrigir aqui, o problema está na Agenda, não na lista. Status: ${JSON.stringify(byStatus)}`
        );
        totalUnfixable += appts.length;
        unfixableLists.push(listId);
        continue;
      }

      console.log(
        `Lista ${listId} (agenda de ${list.agenda.date.toISOString().slice(0, 10)}): ${appts.length} agendamento(s) sob "Todos" -> ${list.agenda.doctor.name} (doctorId ${list.agenda.doctorId}). Status: ${JSON.stringify(byStatus)}`
      );
      totalFixable += appts.length;

      if (APPLY) {
        const result = await prisma.appointment.updateMany({
          where: { listId, doctorId: 8 },
          data: { doctorId: list.agenda.doctorId },
        });
        await recordAudit({
          userId: null,
          action: "fix_doctor_assignment",
          entity: "List",
          entityId: listId,
          field: "doctorId",
          oldValue: 8,
          newValue: list.agenda.doctorId,
          metadata: {
            reason:
              'Auditoria completa do médico placeholder "Todos" (2026-09-03) — PDF de origem sem médico específico no cabeçalho.',
            appointmentsFixed: result.count,
            statusBreakdown: byStatus,
            correctDoctor: list.agenda.doctor.name,
          },
        });
      }
    }

    console.log(`\n=== Resumo ===`);
    console.log(`Corrigível automaticamente (lista tem Agenda com médico certo): ${totalFixable} agendamento(s)`);
    console.log(`NÃO corrigível automaticamente (sem agenda, ou agenda também "Todos"): ${totalUnfixable} agendamento(s), listas: ${unfixableLists.join(", ")}`);
    console.log(APPLY ? "\nAplicado — os agendamentos corrigíveis foram reatribuídos." : "\nDRY-RUN — nada foi alterado. Rode com --apply pra aplicar.");
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
