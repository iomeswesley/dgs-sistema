import { useParams } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { Callout, ErrorNote, Spinner, Table, Td, Th } from "../components/ui";
import { useApi } from "../lib/useApi";
import { formatCalendarDate, formatDateTime } from "../lib/format";

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
  procedureName: string;
  scheduledAt: string;
  messageStatus: string | null;
}

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

          <Table
            head={
              <tr>
                <Th>Paciente</Th>
                <Th>Procedimento</Th>
                <Th>Horário original</Th>
                <Th align="right">Mensagem</Th>
              </tr>
            }
          >
            {detail.data.appointments.map((a) => (
              <tr key={a.id}>
                <Td>{a.patientName}</Td>
                <Td muted>{a.procedureName}</Td>
                <Td muted>{formatDateTime(a.scheduledAt)}</Td>
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
        </>
      )}
    </>
  );
}
