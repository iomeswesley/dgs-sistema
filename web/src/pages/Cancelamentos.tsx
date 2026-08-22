import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDate, formatDateTime } from "../lib/format";

/*
  Cancelamento de agenda inteira — o médico não vai poder atender, e todo
  mundo já agendado precisa saber. Diferente de Listas: não tem upload,
  parte de uma Agenda já cadastrada (município/unidade/data vêm dela,
  sozinhos). Motivo é texto livre, escrito uma vez, valendo pra todo mundo
  que for notificado nesse disparo.
*/

interface Agenda {
  id: number;
  date: string;
  doctor: { name: string };
  municipality: { name: string };
  unit: { name: string } | null;
}

interface CancellablePatient {
  appointmentId: number;
  patientName: string;
  scheduledAt: string;
  procedureName: string;
  status: string;
}

interface CancellationPreview {
  agenda: { id: number; date: string; doctorName: string; municipalityName: string; unitName: string | null };
  patients: CancellablePatient[];
}

interface CancellationBatchSummary {
  id: number;
  reason: string;
  createdAt: string;
  createdByName: string;
  agendaDate: string;
  doctorName: string;
  municipalityName: string;
  count: number;
}

export function Cancelamentos() {
  const agendas = useApi<{ agendas: Agenda[] }>("/api/agendas");
  const batches = useApi<{ batches: CancellationBatchSummary[] }>("/api/cancellations");

  const [agendaId, setAgendaId] = useState("");
  const [reason, setReason] = useState("");
  const preview = useApi<CancellationPreview>(
    agendaId ? `/api/cancellations/preview?agendaId=${agendaId}` : null,
    [agendaId]
  );

  const [confirming, setConfirming] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function dispatch() {
    setDispatching(true);
    setError(null);
    try {
      const result = await api.post<{ batchId: number; queued: number }>("/api/cancellations", {
        agendaId: Number(agendaId),
        reason,
      });
      setNotice(`Cancelamento disparado — ${result.queued} paciente(s) notificado(s).`);
      setConfirming(false);
      setAgendaId("");
      setReason("");
      batches.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao disparar o cancelamento.");
      setConfirming(false);
    } finally {
      setDispatching(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Agenda"
        title="Cancelamento"
        description="Quando o médico não vai poder atender uma agenda inteira — notifica todo mundo já marcado."
      />

      <Callout>
        Escolha a agenda que precisa ser cancelada — município, unidade e médico vêm sozinhos, sem precisar
        selecionar de novo. Quem já recusou, já foi cancelado antes ou pediu pra não receber mensagens não é
        notificado de novo.
      </Callout>

      {notice && (
        <div className="my-3">
          <Callout>{notice}</Callout>
        </div>
      )}
      {error && (
        <div className="my-3">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="card mt-4 p-4">
        <Field label="Agenda a cancelar">
          <select
            className="field"
            value={agendaId}
            onChange={(e) => {
              setAgendaId(e.target.value);
              setReason("");
            }}
          >
            <option value="">Selecione…</option>
            {agendas.data?.agendas.map((a) => (
              <option key={a.id} value={a.id}>
                {formatDate(a.date)} — {a.doctor.name} — {a.municipality.name}
                {a.unit ? ` (${a.unit.name})` : ""}
              </option>
            ))}
          </select>
        </Field>

        {agendaId && (
          <>
            <Field label="Motivo" hint="Vai literalmente na mensagem — escreva pensando no paciente lendo.">
              <textarea
                className="field"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Profissional irá realizar uma cirurgia e ficará ausente por uma semana."
              />
            </Field>

            {preview.loading && <Spinner />}
            {preview.error && <ErrorNote message={preview.error} />}

            {preview.data && (
              <>
                {preview.data.patients.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">
                    Ninguém elegível pra notificar nessa agenda (todo mundo já recusou, foi cancelado antes, ou
                    não tem telefone).
                  </p>
                ) : (
                  <>
                    <p className="mt-3 text-sm text-ink-muted">
                      {preview.data.patients.length} paciente(s) vão receber o aviso:
                    </p>
                    <Table
                      head={
                        <tr>
                          <Th>Paciente</Th>
                          <Th>Procedimento</Th>
                          <Th>Horário</Th>
                        </tr>
                      }
                    >
                      {preview.data.patients.map((p) => (
                        <tr key={p.appointmentId}>
                          <Td>{p.patientName}</Td>
                          <Td muted>{p.procedureName}</Td>
                          <Td muted>{formatDateTime(p.scheduledAt)}</Td>
                        </tr>
                      ))}
                    </Table>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!reason.trim()}
                        onClick={() => setConfirming(true)}
                      >
                        Cancelar e notificar {preview.data.patients.length} paciente(s)
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">
        Cancelamentos já feitos
      </h2>
      {batches.loading && <Spinner />}
      {batches.data?.batches.length === 0 && !batches.loading && (
        <p className="text-sm text-ink-muted">Nenhum cancelamento disparado ainda.</p>
      )}
      {batches.data && batches.data.batches.length > 0 && (
        <Table
          head={
            <tr>
              <Th>Data da agenda</Th>
              <Th>Médico</Th>
              <Th>Município</Th>
              <Th align="right">Pacientes</Th>
              <Th>Disparado em</Th>
              <Th align="right">Ações</Th>
            </tr>
          }
        >
          {batches.data.batches.map((b) => (
            <tr key={b.id}>
              <Td>{formatDate(b.agendaDate)}</Td>
              <Td muted>{b.doctorName}</Td>
              <Td muted>{b.municipalityName}</Td>
              <Td align="right" muted>
                {b.count}
              </Td>
              <Td muted>{formatDateTime(b.createdAt)}</Td>
              <Td align="right">
                <Link to={`/cancelamentos/${b.id}`} className="text-accent underline underline-offset-2">
                  Ver mensagens
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <ConfirmModal
        open={confirming}
        title="Cancelar essa agenda e notificar?"
        description={
          preview.data
            ? `Vai mandar a mensagem de cancelamento pra ${preview.data.patients.length} paciente(s) agora. Isso não pode ser desfeito.`
            : ""
        }
        confirmLabel="Sim, cancelar e notificar"
        danger
        busy={dispatching}
        onConfirm={() => void dispatch()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
