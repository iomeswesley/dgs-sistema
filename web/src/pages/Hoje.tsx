import { useState } from "react";
import { EmptyState, PageHeader } from "../components/AppShell";
import { FormModal } from "../components/FormModal";
import { StatusBand } from "../components/StatusBand";
import { Callout, ErrorNote, Field, Spinner, StatusPill, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { runQueueUntilDone } from "../lib/queue";
import {
  daysAgo,
  formatDateTime,
  formatPhone,
  localDateString,
  REFUSAL_LABEL,
  toBandCounts,
} from "../lib/format";

interface Appointment {
  id: number;
  scheduledAt: string;
  status: string;
  selectedPhone: string | null;
  refusalReason: string | null;
  refusalNote: string | null;
  contactNote: string | null;
  contactedAt: string | null;
  patient: { id: number; name: string; optedOut: boolean };
  doctor: { name: string };
  procedure: { name: string };
  municipality: { name: string };
  contactedBy: { name: string } | null;
  messages: {
    direction: string;
    status: string;
    body: string | null;
    errorMessage: string | null;
    raw: { aiClassified?: boolean; aiConfidence?: number; aiReasoning?: string } | null;
  }[];
}

interface Capacity {
  dailyLimit: number;
  used: number;
  remaining: number;
  pending: number;
}

export function Hoje() {
  const [from, setFrom] = useState(localDateString());
  const [to, setTo] = useState(daysAgo(-7));
  const [statusFilter, setStatusFilter] = useState("");

  const query = new URLSearchParams({ from, to, ...(statusFilter ? { status: statusFilter } : {}) });
  const data = useApi<{ appointments: Appointment[]; capacity: Capacity }>(
    `/api/appointments?${query}`,
    [from, to, statusFilter]
  );
  const summary = useApi<{ counts: Record<string, number> }>(
    `/api/appointments/summary?from=${from}&to=${to}`,
    [from, to]
  );

  const [contacting, setContacting] = useState<Appointment | null>(null);
  const [outcome, setOutcome] = useState<"CONFIRMADO" | "RECUSADO" | "SEM_RESPOSTA">("CONFIRMADO");
  const [reason, setReason] = useState("HORARIO_RUIM");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<string | null>(null);

  async function saveContact() {
    if (!contacting) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/appointments/${contacting.id}/contact`, {
        outcome,
        refusalReason: outcome === "RECUSADO" ? reason : null,
        refusalNote: outcome === "RECUSADO" ? note : null,
        contactNote: outcome !== "RECUSADO" ? note : null,
      });
      setContacting(null);
      setNote("");
      data.reload();
      summary.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar o contato.");
    } finally {
      setBusy(false);
    }
  }

  async function processQueue() {
    setBusy(true);
    try {
      // Continua chamando sozinho até esvaziar o que já está no horário de
      // sair — uma lista grande pode não caber numa chamada só (o servidor
      // pára perto do limite de tempo da função), e nunca deve depender do
      // cron do dia seguinte pra terminar (achado em 2026-08-26, ver
      // comentário em lib/queue.ts).
      const result = await runQueueUntilDone(({ sent, failed }) => {
        setProcessResult(`${sent} enviadas, ${failed} falharam até agora — ainda processando...`);
        data.reload();
        summary.reload();
      });
      setProcessResult(
        `${result.sent} enviadas, ${result.failed} falharam. Cabem mais ${result.remainingToday} hoje.`
      );
      data.reload();
      summary.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao processar a fila.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sem o cron horário ativo (plano Hobby), a cadência do dia — lembrete de
   * véspera, reenvio por telefone alternativo, envio, fechamento de quem
   * passou do horário e expurgo LGPD — só roda quando alguém clica aqui.
   */
  async function runCadence() {
    setBusy(true);
    try {
      const result = await api.post<{
        sent: number;
        failed: number;
        deferred: number;
        remainingToday: number;
        remindersQueued: number;
        retriesQueued: number;
        closedAsNoAnswer: number;
      }>("/api/queue/run-cadence");
      let sent = result.sent;
      let failed = result.failed;
      setProcessResult(`${sent} enviadas, ${failed} falharam até agora — ainda processando...`);
      // O envio em si (o passo que mais demora) pode não ter cabido inteiro
      // na chamada da cadência — completa sozinho, sem depender do cron do
      // dia seguinte (achado em 2026-08-26, ver comentário em lib/queue.ts).
      const finished = await runQueueUntilDone((progress) => {
        sent = result.sent + progress.sent;
        failed = result.failed + progress.failed;
        setProcessResult(`${sent} enviadas, ${failed} falharam até agora — ainda processando...`);
      });
      sent = result.sent + finished.sent;
      failed = result.failed + finished.failed;
      setProcessResult(
        `${sent} enviadas, ${failed} falharam · ${result.remindersQueued} lembretes e ` +
          `${result.retriesQueued} reenvios criados · ${result.closedAsNoAnswer} fechados sem resposta. ` +
          `Cabem mais ${finished.remainingToday} hoje.`
      );
      data.reload();
      summary.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao rodar a cadência.");
    } finally {
      setBusy(false);
    }
  }

  const capacity = data.data?.capacity;

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Acompanhamento"
        description="Como está a resposta das listas disparadas, por período."
        actions={
          <div className="flex gap-2">
            {capacity && capacity.pending > 0 && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={processQueue}>
                Enviar {Math.min(capacity.pending, capacity.remaining)} da fila
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={busy} onClick={runCadence}>
              Rodar cadência do dia
            </button>
          </div>
        }
      />

      {processResult && (
        <div className="mb-4">
          <Callout>{processResult}</Callout>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {capacity && (
        <div className="mb-5">
          <Callout tone={capacity.remaining === 0 && capacity.pending > 0 ? "warn" : "info"}>
            <span className="tabular font-semibold">{capacity.used}</span> de{" "}
            <span className="tabular">{capacity.dailyLimit}</span> mensagens usadas hoje ·{" "}
            <span className="tabular font-semibold">{capacity.pending}</span> na fila.
            {capacity.remaining === 0 && capacity.pending > 0 && (
              <> O limite de hoje acabou — o restante sai amanhã automaticamente.</>
            )}
          </Callout>
        </div>
      )}

      <div className="card mb-5 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="De">
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até">
            <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Situação">
            <select
              className="field"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="CONFIRMADO">Confirmou</option>
              <option value="RECUSADO">Recusou</option>
              <option value="ENVIADO">Enviado, sem resposta</option>
              <option value="ENTREGUE">Entregue, sem resposta</option>
              <option value="SEM_TELEFONE">Sem telefone</option>
              <option value="FALHA">Falha no envio</option>
            </select>
          </Field>
        </div>

        {summary.data && (
          <div className="mt-5">
            <StatusBand counts={toBandCounts(summary.data.counts)} />
          </div>
        )}
      </div>

      {data.loading && <Spinner />}
      {data.error && <ErrorNote message={data.error} />}

      {data.data?.appointments.length === 0 && !data.loading && (
        <EmptyState
          title="Nenhum atendimento no período"
          description="Ajuste as datas acima, ou dispare uma lista aprovada para as confirmações começarem a chegar aqui."
        />
      )}

      {(data.data?.appointments.length ?? 0) > 0 && (
        <Table
          head={
            <tr>
              <Th>Paciente</Th>
              <Th>Telefone</Th>
              <Th>Data e hora</Th>
              <Th>Médico / município</Th>
              <Th>Situação</Th>
              <Th align="right">Ação</Th>
            </tr>
          }
        >
          {data.data?.appointments.map((appointment) => {
            const lastError = appointment.messages.find((message) => message.errorMessage);
            const lastReply = appointment.messages.find(
              (message) => message.direction === "RECEBIDA" && message.body
            );
            return (
              <tr key={appointment.id}>
                <Td>
                  <span className="font-medium">{appointment.patient.name}</span>
                  <p className="text-xs text-ink-faint">{appointment.procedure.name}</p>
                </Td>
                <Td muted>
                  <span className="tabular">{formatPhone(appointment.selectedPhone)}</span>
                  {appointment.patient.optedOut && (
                    <p className="text-xs text-mark-red">não quer receber</p>
                  )}
                </Td>
                <Td muted>{formatDateTime(appointment.scheduledAt)}</Td>
                <Td muted>
                  {appointment.doctor.name}
                  <p className="text-xs text-ink-faint">{appointment.municipality.name}</p>
                </Td>
                <Td>
                  <StatusPill status={appointment.status} />
                  {appointment.refusalReason && (
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {REFUSAL_LABEL[appointment.refusalReason] ?? appointment.refusalReason}
                    </p>
                  )}
                  {appointment.refusalNote && (
                    <p className="text-xs italic text-ink-faint">{appointment.refusalNote}</p>
                  )}
                  {appointment.contactedBy && (
                    <p className="text-xs text-ink-faint">contato por {appointment.contactedBy.name}</p>
                  )}
                  {lastReply && (
                    <p className="mt-0.5 text-xs italic text-ink-faint">"{lastReply.body}"</p>
                  )}
                  {lastReply?.raw?.aiClassified && (
                    <p className="text-xs text-accent">
                      IA leu como {lastReply.raw.aiConfidence && lastReply.raw.aiConfidence >= 0.7
                        ? "resposta clara"
                        : `incerta (${Math.round((lastReply.raw.aiConfidence ?? 0) * 100)}%)`}
                      {" — "}
                      {lastReply.raw.aiReasoning}
                    </p>
                  )}
                  {lastError && <p className="text-xs text-mark-red">{lastError.errorMessage}</p>}
                </Td>
                <Td align="right">
                  <button
                    type="button"
                    className="btn btn-quiet px-2 py-1 text-xs"
                    onClick={() => {
                      setContacting(appointment);
                      setOutcome("CONFIRMADO");
                      setNote("");
                    }}
                  >
                    Registrar contato
                  </button>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      <FormModal
        open={contacting !== null}
        title={`Contato com ${contacting?.patient.name ?? ""}`}
        description="O que a equipe registrar aqui entra no relatório devolvido à secretaria."
        busy={busy}
        error={error}
        onSubmit={saveContact}
        onCancel={() => setContacting(null)}
      >
        <Field label="Resultado da ligação">
          <select
            className="field"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as typeof outcome)}
          >
            <option value="CONFIRMADO">Confirmou presença</option>
            <option value="RECUSADO">Não vai comparecer</option>
            <option value="SEM_RESPOSTA">Não atendeu</option>
          </select>
        </Field>

        {outcome === "RECUSADO" && (
          <Field label="Motivo">
            <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(REFUSAL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Observação" hint="Opcional. Ex.: pediu para ligar depois das 18h.">
          <textarea
            className="field"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </FormModal>
    </>
  );
}
