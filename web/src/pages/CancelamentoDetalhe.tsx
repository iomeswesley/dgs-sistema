import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { useApi } from "../lib/useApi";
import { formatCalendarDate, formatDateTime, formatPhone } from "../lib/format";
import { api } from "../lib/api";
import { runQueueUntilDone } from "../lib/queue";

// Status de entrega da mensagem (DeliveryStatus), não de agendamento — por
// isso não reaproveita StatusPill, que é rotulado pra confirmação/recusa.
const MESSAGE_STATUS_LABEL: Record<string, string> = {
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  LIDO: "Lido",
  FALHOU: "Falhou",
};

// Legenda do que cada situação de mensagem quer dizer — pedido do usuário,
// pra não depender de perguntar toda vez. "Entregue" sem "Lido" é comum e
// não indica problema: muita gente desativa o recibo de leitura do
// WhatsApp, a mensagem chega e a pessoa consegue ler/responder normalmente
// mesmo assim, só não gera a confirmação "Lido" pro remetente.
const MESSAGE_STATUS_EXPLANATION: { status: string; text: string }[] = [
  { status: "ENVIADO", text: "Saiu do nosso número, ainda sem confirmação de chegada." },
  { status: "ENTREGUE", text: "Chegou no celular do paciente. Pode não virar \"Lido\" mesmo assim — muita gente desativa o recibo de leitura, mas continua recebendo e respondendo normalmente." },
  { status: "LIDO", text: "O paciente abriu a conversa e viu a mensagem." },
  { status: "FALHOU", text: "Não chegou — na prática, quase sempre número sem WhatsApp, inválido ou inalcançável (a Meta não distingue qual dos três)." },
];

// Enviado/Entregue ainda em trânsito (amarelo, como o resto do sistema usa
// pra "aguardando"), Lido é o desfecho positivo (verde), Falhou é o negativo
// (vermelho) — achado pelo usuário que estava tudo cinza, sem diferenciar.
const MESSAGE_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  ENVIADO: { bg: "var(--mark-yellow-soft)", fg: "var(--mark-yellow)" },
  ENTREGUE: { bg: "var(--mark-yellow-soft)", fg: "var(--mark-yellow)" },
  LIDO: { bg: "var(--mark-green-soft)", fg: "var(--mark-green)" },
  FALHOU: { bg: "var(--mark-red-soft)", fg: "var(--mark-red)" },
};

function MessageStatusBadge({ status }: { status: string }) {
  const tone = MESSAGE_STATUS_TONE[status] ?? { bg: "var(--mark-gray-soft)", fg: "var(--mark-gray)" };
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: tone.bg, color: tone.fg }}
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
  alternatePhone: string | null;
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

interface ExtractionReconciliation {
  extracted: number;
  remaining: number;
}

interface CancellationBatchDetail {
  id: number;
  source: CancellationSourceInfo;
  reason: string;
  createdAt: string;
  createdByName: string;
  extractionReconciliation: ExtractionReconciliation | null;
  appointments: CancellationAppointment[];
}

export function CancelamentoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<CancellationBatchDetail>(id ? `/api/cancellations/${id}` : null, [id]);
  const [messageFilter, setMessageFilter] = useState("");

  // Reenvio pra quem falhou: telefone novo por paciente, pré-preenchido com
  // o alternativo do cadastro quando existe — em branco quando não, pra
  // equipe digitar. Guardado por appointmentId, não recriado a cada render.
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryPhones, setRetryPhones] = useState<Record<number, string>>({});
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const appointments = detail.data?.appointments ?? [];
    if (!messageFilter) return appointments;
    if (messageFilter === SEM_ENVIO) return appointments.filter((a) => !a.messageStatus);
    return appointments.filter((a) => a.messageStatus === messageFilter);
  }, [detail.data, messageFilter]);

  // Inclui tanto FALHOU quanto "sem envio" (sem telefone nenhum no
  // cadastro — vira CANCELADO mas nunca teve pra onde mandar mensagem,
  // achado em 2026-08-26): os dois precisam do mesmo "digite um telefone e
  // reenvia", pra ninguém ficar sem ser avisado por falta de um jeito de
  // corrigir depois do disparo.
  const failedAppointments = useMemo(
    () => detail.data?.appointments.filter((a) => a.messageStatus === "FALHOU" || !a.messageStatus) ?? [],
    [detail.data]
  );

  function openRetry() {
    const initial: Record<number, string> = {};
    for (const a of failedAppointments) initial[a.id] = a.alternatePhone ?? "";
    setRetryPhones(initial);
    setRetryError(null);
    setRetryOpen(true);
  }

  async function submitRetry() {
    const updates = Object.entries(retryPhones)
      .filter(([, phone]) => phone.trim().length > 0)
      .map(([appointmentId, phone]) => ({ appointmentId: Number(appointmentId), phone: phone.trim() }));
    if (updates.length === 0) {
      setRetryError("Preencha ao menos um telefone pra reenviar.");
      return;
    }
    setRetryBusy(true);
    setRetryError(null);
    try {
      const result = await api.post<{ queued: number }>(`/api/cancellations/${id}/retry-failed`, { updates });
      setRetryOpen(false);
      setRetryNotice(`Reenviando pra ${result.queued} paciente(s)...`);
      const finished = await runQueueUntilDone(({ sent, failed }) => {
        setRetryNotice(`Reenviando... ${sent} enviada(s), ${failed} falharam.`);
      });
      setRetryNotice(
        `Reenvio concluído — ${finished.sent} enviada(s)` + (finished.failed > 0 ? `, ${finished.failed} falharam` : "") + "."
      );
      detail.reload();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Falha ao reenviar.");
    } finally {
      setRetryBusy(false);
    }
  }

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
              {detail.data.extractionReconciliation && (
                <p className="mt-2 text-xs text-ink-faint">
                  {detail.data.extractionReconciliation.extracted === detail.data.extractionReconciliation.remaining ? (
                    <>
                      Confere com o PDF original: {detail.data.extractionReconciliation.remaining} de{" "}
                      {detail.data.extractionReconciliation.extracted} pacientes extraídos.
                    </>
                  ) : (
                    <>
                      Confere com o PDF original: {detail.data.extractionReconciliation.extracted} pacientes
                      extraídos, {detail.data.extractionReconciliation.extracted -
                        detail.data.extractionReconciliation.remaining}{" "}
                      removido(s) na revisão antes de aprovar (duplicata ou linha que não era dessa agenda) —{" "}
                      {detail.data.extractionReconciliation.remaining} restaram, batendo com o total abaixo.
                    </>
                  )}
                </p>
              )}
            </Callout>
          </div>

          <div className="card mb-4 p-4">
            <p className="eyebrow mb-2">O que significa cada situação da mensagem</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {MESSAGE_STATUS_EXPLANATION.map((item) => (
                <div key={item.status} className="flex items-start gap-2">
                  <dt className="mt-0.5 shrink-0">
                    <MessageStatusBadge status={item.status} />
                  </dt>
                  <dd className="text-xs text-ink-muted">{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>

          {retryNotice && (
            <div className="mb-4">
              <Callout>{retryNotice}</Callout>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
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
            {failedAppointments.length > 0 && (
              <button type="button" className="btn btn-primary px-3 py-1.5 text-sm" onClick={openRetry}>
                Reenviar pra quem falhou/sem telefone ({failedAppointments.length})
              </button>
            )}
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

          <FormModal
            open={retryOpen}
            title="Reenviar pra quem falhou/sem telefone"
            description="Quando o paciente tem outro celular no cadastro, já vem preenchido. Deixe em branco pra não reenviar pra esse paciente."
            submitLabel="Reenviar"
            busy={retryBusy}
            error={retryError}
            onSubmit={submitRetry}
            onCancel={() => setRetryOpen(false)}
          >
            {failedAppointments.map((a) => (
              <Field
                key={a.id}
                label={a.patientName}
                hint={a.phone ? `Número que falhou: ${formatPhone(a.phone)}` : "Sem telefone no cadastro"}
              >
                <input
                  className="field"
                  type="tel"
                  placeholder="Novo telefone (com DDD)"
                  value={retryPhones[a.id] ?? ""}
                  onChange={(e) => setRetryPhones((prev) => ({ ...prev, [a.id]: e.target.value }))}
                />
              </Field>
            ))}
          </FormModal>
        </>
      )}
    </>
  );
}
