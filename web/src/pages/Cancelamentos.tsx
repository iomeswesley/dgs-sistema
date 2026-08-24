import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatCalendarDate, formatDateTime } from "../lib/format";

/*
  Cancelamento de agenda inteira — o médico não vai poder atender, e todo
  mundo já agendado precisa saber. Duas origens:

  - Agenda já cadastrada: município/unidade/médico/data vêm dela, sozinhos.
  - PDF enviado na hora, sem agenda (2026-08-25) — pro caso de a agenda nunca
    ter passado pela plataforma. Reaproveita o mesmo upload/extração de
    Listas (POST /api/lists sem agendaId), só que sem passar pelo fluxo
    normal de Revisão/Aprovar — a extração já alimenta direto a revisão de
    quem vai ser notificado do cancelamento.

  Motivo é texto livre, escrito uma vez, valendo pra todo mundo notificado
  nesse disparo.
*/

interface Agenda {
  id: number;
  date: string;
  doctor: { name: string };
  municipality: { name: string };
  unit: { name: string } | null;
}

interface Municipality {
  id: number;
  name: string;
}

interface CancellablePatient {
  appointmentId: number;
  patientName: string;
  scheduledAt: string;
  procedureName: string;
  status: string;
}

interface CancellationSourceInfo {
  date: string;
  doctorName: string;
  municipalityName: string;
  unitName: string | null;
}

interface CancellationPreview {
  source: CancellationSourceInfo;
  patients: CancellablePatient[];
}

interface CancellationBatchSummary {
  id: number;
  source: CancellationSourceInfo;
  reason: string;
  createdAt: string;
  createdByName: string;
  count: number;
}

type Mode = "agenda" | "upload";
type ListPollStatus = "idle" | "uploading" | "extraindo" | "pronta" | "erro";

export function Cancelamentos() {
  const agendas = useApi<{ agendas: Agenda[] }>("/api/agendas");
  const municipalities = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const batches = useApi<{ batches: CancellationBatchSummary[] }>("/api/cancellations");

  const [mode, setMode] = useState<Mode>("agenda");
  const [agendaId, setAgendaId] = useState("");
  const [reason, setReason] = useState("");

  // Modo upload: sobe o PDF (sem agenda) igual Listas faz, espera a
  // extração terminar, e o listId resultante vira a origem do cancelamento.
  const [municipalityId, setMunicipalityId] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadedListId, setUploadedListId] = useState<number | null>(null);
  const [listStatus, setListStatus] = useState<ListPollStatus>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sourceQuery =
    mode === "agenda" ? (agendaId ? `agendaId=${agendaId}` : null) : uploadedListId ? `listId=${uploadedListId}` : null;
  const preview = useApi<CancellationPreview>(
    sourceQuery ? `/api/cancellations/preview?${sourceQuery}` : null,
    [sourceQuery]
  );

  const [confirming, setConfirming] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setReason("");
    setAgendaId("");
    setMunicipalityId("");
    setPendingFile(null);
    setUploadedListId(null);
    setListStatus("idle");
    setListError(null);
    if (fileRef.current) fileRef.current.value = "";
    if (pollRef.current) clearInterval(pollRef.current);
  }

  async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  async function uploadForCancellation() {
    if (!pendingFile || !municipalityId) return;
    setListStatus("uploading");
    setListError(null);
    try {
      const { list } = await api.post<{ list: { id: number; status: string } }>("/api/lists", {
        municipalityId: Number(municipalityId),
        originalName: pendingFile.name,
        mimeType: pendingFile.type || "application/pdf",
        fileBase64: await fileToBase64(pendingFile),
      });
      setUploadedListId(list.id);
      setListStatus(list.status === "EM_REVISAO" ? "pronta" : "extraindo");

      if (list.status !== "EM_REVISAO") {
        pollRef.current = setInterval(async () => {
          try {
            const detail = await api.get<{ list: { status: string; extractionError: string | null } }>(
              `/api/lists/${list.id}`
            );
            if (detail.list.status === "EM_REVISAO") {
              setListStatus("pronta");
              if (pollRef.current) clearInterval(pollRef.current);
            } else if (detail.list.status === "ERRO") {
              setListStatus("erro");
              setListError(detail.list.extractionError ?? "Falha na leitura do PDF.");
              if (pollRef.current) clearInterval(pollRef.current);
            }
          } catch {
            // tenta de novo no próximo tick
          }
        }, 2500);
      }
    } catch (err) {
      setListStatus("erro");
      setListError(err instanceof Error ? err.message : "Falha ao enviar o PDF.");
    }
  }

  async function dispatch() {
    setDispatching(true);
    setError(null);
    try {
      const result = await api.post<{ batchId: number; queued: number }>("/api/cancellations", {
        ...(mode === "agenda" ? { agendaId: Number(agendaId) } : { listId: uploadedListId }),
        reason,
      });
      setNotice(`Cancelamento disparado — ${result.queued} paciente(s) notificado(s).`);
      setConfirming(false);
      switchMode(mode);
      batches.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao disparar o cancelamento.");
      setConfirming(false);
    } finally {
      setDispatching(false);
    }
  }

  const readyForPreview = mode === "agenda" ? !!agendaId : listStatus === "pronta";

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
        <div className="mb-4 flex gap-1 border-b border-rule">
          {(
            [
              { id: "agenda" as const, label: "Agenda já cadastrada" },
              { id: "upload" as const, label: "Nunca passou pela plataforma (enviar PDF)" },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchMode(tab.id)}
              className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                mode === tab.id
                  ? "border-accent font-semibold text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === "agenda" ? (
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
                  {formatCalendarDate(a.date)} — {a.doctor.name} — {a.municipality.name}
                  {a.unit ? ` (${a.unit.name})` : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-muted">
              A lista nunca foi cadastrada como agenda, mas o médico não vai poder atender mesmo assim. Envie o
              PDF (SISREG ou CELK) — o sistema lê os pacientes sozinho, do mesmo jeito que faz em Listas, mas em
              vez de mandar confirmação, cancela direto.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Município">
                <select
                  className="field"
                  value={municipalityId}
                  onChange={(e) => setMunicipalityId(e.target.value)}
                  disabled={listStatus === "uploading" || listStatus === "extraindo"}
                >
                  <option value="">Selecione…</option>
                  {municipalities.data?.municipalities.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Arquivo PDF">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  className="field"
                  disabled={listStatus === "uploading" || listStatus === "extraindo"}
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                />
              </Field>
            </div>

            {listError && (
              <div className="mt-3">
                <ErrorNote message={listError} />
              </div>
            )}

            {listStatus === "idle" || listStatus === "erro" ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!pendingFile || !municipalityId}
                  onClick={() => void uploadForCancellation()}
                >
                  Enviar e ler o PDF
                </button>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
                {listStatus === "uploading" && "Enviando…"}
                {listStatus === "extraindo" && "Lendo o PDF (o mesmo motor da tela de Listas)…"}
                {listStatus === "pronta" && "PDF lido — confira abaixo quem vai ser notificado."}
              </div>
            )}
          </>
        )}

        {readyForPreview && (
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
                <p className="mt-1 text-xs text-ink-faint">
                  {preview.data.source.doctorName} · {formatCalendarDate(preview.data.source.date)} ·{" "}
                  {preview.data.source.municipalityName}
                  {preview.data.source.unitName ? ` (${preview.data.source.unitName})` : ""}
                </p>
                {preview.data.patients.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">
                    Ninguém elegível pra notificar (todo mundo já recusou, foi cancelado antes, ou não tem
                    telefone).
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
              <Td>{formatCalendarDate(b.source.date)}</Td>
              <Td muted>{b.source.doctorName}</Td>
              <Td muted>{b.source.municipalityName}</Td>
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
        title="Cancelar e notificar?"
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
