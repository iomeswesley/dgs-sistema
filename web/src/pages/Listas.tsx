import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "../components/AppShell";
import { StatusBand } from "../components/StatusBand";
import { Callout, ErrorNote, Field, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDate, LIST_STATUS_LABEL, toBandCounts } from "../lib/format";

interface ListSummary {
  id: number;
  originalName: string;
  status: string;
  sourceFormat: string;
  isComplementary: boolean;
  extractionError: string | null;
  createdAt: string;
  municipality: { id: number; name: string };
  agenda: { id: number; date: string } | null;
  uploadedBy: { name: string };
  counts: Record<string, number>;
}

interface Municipality {
  id: number;
  name: string;
}

interface Agenda {
  id: number;
  date: string;
  municipalityId: number;
  doctor: { name: string };
}

const MAX_BYTES = 20 * 1024 * 1024;

export function Listas() {
  const lists = useApi<{ lists: ListSummary[]; extractionConfigured: boolean }>("/api/lists");
  const municipalities = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const agendas = useApi<{ agendas: Agenda[] }>("/api/agendas");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [municipalityId, setMunicipalityId] = useState<string>("");
  const [agendaId, setAgendaId] = useState<string>("");
  const [isComplementary, setIsComplementary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Enquanto alguma lista está EXTRAINDO, o status só muda sozinho no banco
  // — sem isso a listagem ficava presa até a equipe apertar F5.
  const hasExtracting = (lists.data?.lists ?? []).some((list) => list.status === "EXTRAINDO");
  useEffect(() => {
    if (!hasExtracting) return;
    const interval = setInterval(() => lists.reload(), 3000);
    return () => clearInterval(interval);
  }, [hasExtracting, lists.reload]);

  const agendaOptions = (agendas.data?.agendas ?? []).filter(
    (agenda) => String(agenda.municipalityId) === municipalityId
  );

  async function handleUpload(file: File) {
    if (!municipalityId) {
      setError("Escolha o município antes de enviar.");
      return;
    }
    if (isComplementary && !agendaId) {
      setError("Lista complementar precisa estar vinculada a uma agenda — é o que garante o disparo só pras vagas abertas.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Arquivo maior que 20 MB. Divida em partes.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      // btoa não aceita a string inteira de uma vez em arquivos grandes;
      // converter em blocos evita estourar a pilha de argumentos.
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }

      await api.post("/api/lists", {
        municipalityId: Number(municipalityId),
        agendaId: agendaId ? Number(agendaId) : null,
        isComplementary,
        originalName: file.name,
        mimeType: file.type || "application/pdf",
        fileBase64: btoa(binary),
      });
      if (fileRef.current) fileRef.current.value = "";
      setIsComplementary(false);
      setAgendaId("");
      lists.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Entrada"
        title="Listas"
        description="Cada arquivo recebido de uma prefeitura vira uma lista: leitura automática, revisão da equipe e só então o disparo."
      />

      {lists.data && !lists.data.extractionConfigured && (
        <div className="mb-5">
          <Callout tone="warn">
            A leitura automática está desligada (falta a chave da API no servidor). As listas enviadas
            entram direto em revisão, com os pacientes cadastrados à mão.
          </Callout>
        </div>
      )}

      <div className="card mb-6 p-5">
        <p className="eyebrow">Enviar lista</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Município">
            <select
              className="field"
              value={municipalityId}
              onChange={(event) => {
                setMunicipalityId(event.target.value);
                setAgendaId("");
              }}
            >
              <option value="">Selecione…</option>
              {municipalities.data?.municipalities.map((municipality) => (
                <option key={municipality.id} value={municipality.id}>
                  {municipality.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Agenda vinculada"
            hint={
              isComplementary
                ? "Obrigatório para lista complementar."
                : "Opcional — liga a sugestão de confirmações à capacidade cadastrada."
            }
          >
            <select
              className="field"
              value={agendaId}
              onChange={(event) => setAgendaId(event.target.value)}
              disabled={!municipalityId}
            >
              <option value="">Nenhuma</option>
              {agendaOptions.map((agenda) => (
                <option key={agenda.id} value={agenda.id}>
                  {agenda.doctor.name} — {formatDate(agenda.date)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={isComplementary}
            onChange={(event) => setIsComplementary(event.target.checked)}
          />
          Esta é uma lista complementar (reposição de vagas abertas de uma agenda já disparada)
        </label>

        <div className="mt-3">
          <Field label="Arquivo" hint="PDF ou foto da agenda (JPG, PNG ou WebP), até 20 MB.">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              className="field"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </Field>
        </div>

        {uploading && <p className="mt-3 text-sm text-ink-muted">Enviando…</p>}
        {error && (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        )}
        {municipalities.data?.municipalities.length === 0 && (
          <p className="mt-3 text-sm text-ink-muted">
            Nenhum município cadastrado ainda —{" "}
            <Link to="/configuracoes" className="text-accent underline underline-offset-2">
              cadastre o primeiro
            </Link>
            .
          </p>
        )}
      </div>

      {lists.loading && <Spinner />}
      {lists.error && <ErrorNote message={lists.error} />}

      {lists.data?.lists.length === 0 && !lists.loading && (
        <EmptyState
          title="Nenhuma lista ainda"
          description="Envie o PDF ou a foto da agenda acima. O sistema lê o arquivo e deixa tudo pronto para a equipe conferir antes de qualquer disparo."
        />
      )}

      <div className="grid gap-3">
        {lists.data?.lists.map((list) => {
          const total = Object.values(list.counts).reduce((sum, value) => sum + value, 0);
          return (
            <Link key={list.id} to={`/listas/${list.id}`} className="card block p-5 hover:border-accent">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">
                    {list.originalName}
                    {list.isComplementary && (
                      <span className="ml-2 align-middle text-xs font-normal text-accent">complementar</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {list.municipality.name}
                    {list.agenda && ` · agenda de ${formatDate(list.agenda.date)}`} · enviada por{" "}
                    {list.uploadedBy.name} em {formatDate(list.createdAt)}
                  </p>
                </div>
                <span className="eyebrow shrink-0">{LIST_STATUS_LABEL[list.status] ?? list.status}</span>
              </div>

              {list.extractionError && (
                <p className="mt-3 rounded-md bg-mark-red-soft px-3 py-2 text-sm text-mark-red">
                  {list.extractionError}
                </p>
              )}

              {total > 0 && (
                <div className="mt-4">
                  <StatusBand counts={toBandCounts(list.counts)} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </>
  );
}
