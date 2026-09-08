/**
 * Auditoria: LEMBRETE (D-1) sobrescrevendo CONFIRMADO — bug sério achado em
 * produção em 2026-09-08 (relatado pelo cliente: "confirmados sumiram",
 * 24→18 numa lista do Mariston, 9→0 noutra).
 *
 * Causa raiz (já corrigida em queue.service.ts): TODO envio de template
 * bem-sucedido (menos CANCELAMENTO) escrevia `status: "ENVIADO"` no
 * agendamento, incondicionalmente — inclusive LEMBRETE, que só é mandado
 * pra quem já está CONFIRMADO (`enqueueReminders`, cadence.service.ts).
 * Toda vez que o cron de lembrete rodava, apagava a confirmação de quem
 * tinha recebido o lembrete. O mesmo valia pra falha de envio (virava FALHA).
 *
 * Esse script varre TODO o histórico (não só as duas listas do relato)
 * atrás de agendamentos com LEMBRETE enviado, cujo status atual não é mais
 * CONFIRMADO, mas cuja última resposta classificável do paciente ANTES do
 * lembrete foi uma confirmação — e nenhuma resposta DEPOIS do lembrete
 * reverteu isso (mesma regra "vale a última resposta" já usada no projeto).
 * Restaura CONFIRMADO nesses casos.
 *
 * Casos ambíguos (resposta "unknown" no meio, ou mais de uma leitura
 * possível) NÃO são corrigidos automaticamente — só listados, pra revisão
 * manual.
 *
 * Dry-run por padrão. `--apply` grava de verdade.
 */
import type { AppointmentStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { classifyReply } from "../src/lib/templates.js";

const APPLY = process.argv.includes("--apply");

// Status que só podem ter chegado assim se o bug tiver sobrescrito um
// CONFIRMADO de verdade (nunca são o destino natural de "acabou de ser
// confirmado" — teriam voltado pra CONFIRMADO se a resposta fosse honrada).
const SUSPECT_STATUSES: AppointmentStatus[] = ["ENVIADO", "ENTREGUE", "FALHA", "SEM_RESPOSTA"];

async function main() {
  await runWithClient(1, async () => {
    const appointments = await prisma.appointment.findMany({
      where: {
        status: { in: SUSPECT_STATUSES },
        messages: { some: { template: "LEMBRETE", direction: "ENVIADA" } },
      },
      select: {
        id: true,
        status: true,
        selectedPhone: true,
        patient: { select: { name: true } },
        list: { select: { id: true, originalName: true } },
        messages: {
          where: { direction: { in: ["ENVIADA", "RECEBIDA"] } },
          orderBy: { createdAt: "asc" },
          select: { direction: true, template: true, buttonPayload: true, body: true, createdAt: true },
        },
      },
    });

    let toFix = 0;
    let ambiguous = 0;

    for (const appointment of appointments) {
      const lembreteAt = appointment.messages.find((m) => m.direction === "ENVIADA" && m.template === "LEMBRETE")
        ?.createdAt;
      if (!lembreteAt) continue;

      const before = appointment.messages.filter((m) => m.direction === "RECEBIDA" && m.createdAt < lembreteAt);
      const after = appointment.messages.filter((m) => m.direction === "RECEBIDA" && m.createdAt >= lembreteAt);

      const lastBefore = before.at(-1);
      if (!lastBefore) continue; // sem resposta nenhuma antes do lembrete — não é caso desse bug

      const beforeIntent = classifyReply({ buttonPayload: lastBefore.buttonPayload, text: lastBefore.body });
      if (beforeIntent !== "confirm") continue; // só nos interessa quem tinha confirmado

      // Alguma resposta depois do lembrete reverteu pra recusa/opt-out de
      // verdade? Então NÃO é o bug — é o paciente mudando de ideia depois,
      // "vale a última resposta" já é a regra do projeto.
      const afterIntents = after.map((m) => classifyReply({ buttonPayload: m.buttonPayload, text: m.body }));
      if (afterIntents.some((i) => i === "refuse" || i === "opt_out")) continue;

      const hasAmbiguousAfter = afterIntents.some((i) => i === "unknown");

      const label = `#${appointment.id} ${appointment.patient.name} — lista ${appointment.list?.id} (${appointment.list?.originalName}) — status atual: ${appointment.status}`;

      if (hasAmbiguousAfter) {
        ambiguous++;
        console.log(`[AMBÍGUO — revisar na mão] ${label} — tem resposta não classificável depois do lembrete, confira a conversa antes de mexer.`);
        continue;
      }

      toFix++;
      console.log(`${APPLY ? "[corrigindo]" : "[dry-run]"} ${label} -> CONFIRMADO`);

      if (APPLY) {
        await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "CONFIRMADO" } });
      }
    }

    console.log(
      `\n${toFix} agendamento(s) ${APPLY ? "corrigido(s)" : "encontrado(s) (rode com --apply pra corrigir)"}.` +
        ` ${ambiguous} ambíguo(s), deixado(s) pra revisão manual.`
    );
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
