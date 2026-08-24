import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { Callout, ErrorNote, Spinner, Table, Td, Th } from "../components/ui";
import { useApi } from "../lib/useApi";
import { formatCalendarDate, formatDateTime, formatPhone } from "../lib/format";

// Status de entrega da mensagem (DeliveryStatus), não de agendamento — por
// isso não reaproveita StatusPill, que é rotulado pra confirmação/recusa.
const MESSAGE_STATUS_LABEL: Record<string, string> = {
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  LIDO: "Lido",
  FALHOU: "Falhou",
};

function MessageStatusBadge({ status }: { status: string }) {
  const isFailed = status === "FALHOU";
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        background: isFailed ? "var(--mark-red-soft)" : "var(--mark-gray-soft)",
        color: isFailed ? "var(--mark-red)" : "var(--mark-gray)",
      }}
    >
      {MESSAGE_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/* Detalhe de um cancelamento já disparado — a tela de "mostra todas as
   mensagens enviadas" que o motivo desse cancelamento pediu. */

interface CancellationAppointment {
  id: number;
  patientName: string;
  phone: string | null;
  procedureName: string;
  scheduledAt: string;
  messageStatus: string | null;
  replied: boolean;
  replyPreview: string | null;
}

// "Sem envio" é pseudo-status pro filtro — cobre quem não tem
// `messageStatus` nenhum (mensagem nunca chegou a ser processada).
const SEM_ENVIO = "SEM_ENVIO";
const MESSAGE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "ENVIADO", label: "Enviado" },
  { value: "ENTREGUE", label: "Entregue" },
  { value: "LIDO", label: "Lido" },
  { value: "FALHOU", label: "Falhou" },
  { value: SEM_ENVIO, label: "Sem envio" },
];

interface CancellationSourceInfo {
  date: string;
  doctorName: string;
  municipalityName: string;
  unitName: string | null;
}

interface CancellationBatchDetail {
  id: number;
  source: CancellationSourceInfo;
  reason: string;
  createdAt: string;
  createdByName: string;
  appointments: CancellationAppointment[];
}

export function CancelamentoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<CancellationBatchDetail>(id ? `/api/cancellations/${id}` : null, [id]);
  const [messageFilter, setMessageFilter] = useState("");

  const filtered = useMemo(() => {
    const appointments = detail.data?.appointments ?? [];
    if (!messageFilter) return appointments;
    if (messageFilter === SEM_ENVIO) return appointments.filter((a) => !a.messageStatus);
    return appointments.filter((a) => a.messageStatus === messageFilter);
  }, [detail.data, messageFilter]);

  return (
    <>
      <PageHeader
        eyebrow="Cancelamento"
        title={
          detail.data ? `${detail.data.source.doctorName} — ${formatCalendarDate(detail.data.source.date)}` : "Cancelamento"
        }
        description={
          detail.data ? `${detail.data.source.municipalityName} · disparado por ${detail.data.createdByName}` : ""
        }
      />

      {detail.loading && <Spinner />}
      {detail.error && <ErrorNote message={detail.error} />}

      {detail.data && (
        <>
          <div className="mb-4">
            <Callout>
              <p className="font-semibold">Motivo informado</p>
              <p className="mt-1">{detail.data.reason}</p>
              <p className="mt-2 text-xs text-ink-faint">
                Disparado em {formatDateTime(detail.data.createdAt)} por {detail.data.createdByName}
              </p>
            </Callout>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {MESSAGE_FILTER_OPTIONS.map((opt) => {
              const count =
                opt.value === ""
                  ? detail.data!.appointments.length
                  : opt.value === SEM_ENVIO
                    ? detail.data!.appointments.filter((a) => !a.messageStatus).length
                    : detail.data!.appointments.filter((a) => a.messageStatus === opt.value).length;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={messageFilter === opt.value}
                  className={`btn px-3 py-1.5 text-sm ${messageFilter === opt.value ? "btn-primary" : "btn-quiet"}`}
                  onClick={() => setMessageFilter(opt.value)}
                >
                  {opt.label} ({count})
                </button>
              );
            })}
          </div>

          <Table
            colgroup={
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[13%]" />
                <col className="w-[17%]" />
                <col className="w-[13%]" />
                <col className="w-[27%]" />
                <col className="w-[10%]" />
              </colgroup>
            }
            head={
              <tr>
                <Th>Paciente</Th>
                <Th>Telefone</Th>
                <Th>Procedimento</Th>
                <Th>Horário original</Th>
                <Th>Respondeu</Th>
                <Th align="right">Mensagem</Th>
              </tr>
            }
          >
            {filtered.map((a) => (
              <tr key={a.id}>
                <Td>{a.patientName}</Td>
                <Td muted>
                  <span className="tabular">{formatPhone(a.phone)}</span>
                </Td>
                <Td muted>{a.procedureName}</Td>
                <Td muted>{formatDateTime(a.scheduledAt)}</Td>
                <Td>
                  {a.replied ? (
                    <span className="text-mark-green">
                      <span className="font-semibold">Sim</span>
                      {a.replyPreview && (
                        <span className="ml-1 italic text-ink-faint">"{a.replyPreview}"</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink-faint">Ainda não</span>
                  )}
                </Td>
                <Td align="right">
                  {a.messageStatus ? (
                    <MessageStatusBadge status={a.messageStatus} />
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          {filtered.length === 0 && (
            <p className="mt-3 text-sm text-ink-muted">Nenhum paciente nessa situação.</p>
          )}
        </>
      )}
    </>
  );
}
