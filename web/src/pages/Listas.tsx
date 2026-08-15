import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "../components/AppShell";
import { FormModal } from "../components/FormModal";
import { StatusBand } from "../components/StatusBand";
import { ErrorNote, Field, Spinner } from "../components/ui";
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
  unit: { id: number; name: string; address: string | null } | null;
}

interface Doctor {
  id: number;
  name: string;
}

interface Unit {
  id: number;
  name: string;
  municipalityId: number;
  address: string | null;
}

interface Procedure {
  id: number;
  name: string;
}

interface ListPreview {
  sourceFormat: string;
  parsed: {
    municipality: string | null;
    executingUnit: string | null;
    doctor: string | null;
    procedure: string | null;
    firstScheduledAt: string | null;
  };
  rowCount: number;
  warnings: string[];
  suggestedMunicipalityId: number | null;
  suggestedUnitId: number | null;
  suggestedDoctorId: number | null;
  suggestedProcedureId: number | null;
  suggestedAgendaId: number | null;
  needsAgendaConfirmation: boolean;
}

const MAX_BYTES = 20 * 1024 * 1024;

// O PDF traz o nome do município em CAIXA ALTA; o cadastro segue Title Case
// ("Blumenau", "Indaial"). Só ajusta capitalização — nunca inventa acento
// que o PDF não tinha, então o nome ainda pode precisar de correção manual
// antes de confirmar o cadastro.
const LOWERCASE_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);
function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .map((word, index) => (index > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

// Mesma lógica de "igual ou um contém o outro" do lib/text-match.ts do
// servidor (não dá pra importar direto — é código de backend) — só pra
// avisar na tela antes de enviar, o cadastro é a fonte da verdade mesmo.
const DIACRITICS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");
function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(DIACRITICS, "").toUpperCase().trim();
}
function unitNamesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function Listas() {
  const lists = useApi<{ lists: ListSummary[]; extractionConfigured: boolean }>("/api/lists");
  const municipalities = useApi<{ municipalities: Municipality[] }>("/api/catalog/municipalities");
  const agendas = useApi<{ agendas: Agenda[] }>("/api/agendas");
  const doctors = useApi<{ doctors: Doctor[] }>("/api/catalog/doctors");
  const units = useApi<{ units: Unit[] }>("/api/catalog/units");
  const procedures = useApi<{ procedures: Procedure[] }>("/api/catalog/procedures");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [municipalityId, setMunicipalityId] = useState<string>("");
  const [agendaId, setAgendaId] = useState<string>("");
  const [isComplementary, setIsComplementary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview: lê o arquivo na hora (rápido, local, sem IA) assim que
  // escolhido, pra sugerir município/agenda antes do envio de verdade.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ListPreview | null>(null);

  // Popup de cadastro: aparece quando o preview leu um nome de município no
  // PDF, mas nenhum município cadastrado bate com ele — sem isso a equipe
  // tinha que sair da tela, cadastrar em Configurações e voltar pra escolher
  // na mão.
  const [municipalityModalOpen, setMunicipalityModalOpen] = useState(false);
  const [municipalityForm, setMunicipalityForm] = useState({ name: "" });
  const [municipalityBusy, setMunicipalityBusy] = useState(false);
  const [municipalityError, setMunicipalityError] = useState<string | null>(null);

  // Popup de confirmação: aparece só quando o preview reconhece município e
  // médico, mas não existe agenda cadastrada pra essa data — é o vínculo
  // que carrega o endereço pra mensagem de WhatsApp.
  const [agendaModalOpen, setAgendaModalOpen] = useState(false);
  const [agendaForm, setAgendaForm] = useState({
    doctorId: "",
    unitId: "",
    procedureId: "",
    date: "",
    shift: "INTEGRAL",
    capacity: "",
  });
  const [agendaBusy, setAgendaBusy] = useState(false);
  const [agendaError, setAgendaError] = useState<string | null>(null);

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
  const agendaModalUnitOptions = (units.data?.units ?? []).filter(
    (unit) => String(unit.municipalityId) === municipalityId
  );

  // Endereço que vai de fato pra mensagem de WhatsApp é o da unidade
  // cadastrada na agenda — não o texto livre que o PDF trouxe. Mostrar os
  // dois lado a lado aqui evita descobrir só depois do disparo que a
  // agenda reaproveitada apontava pra unidade errada do município.
  const selectedAgenda = agendaOptions.find((agenda) => String(agenda.id) === agendaId) ?? null;
  const pdfExecutingUnit = preview?.parsed.executingUnit ?? null;
  const unitMismatch =
    !!selectedAgenda?.unit && !!pdfExecutingUnit && !unitNamesLikelyMatch(pdfExecutingUnit, selectedAgenda.unit.name);

  // btoa não aceita a string inteira de uma vez em arquivos grandes;
  // converter em blocos evita estourar a pilha de argumentos.
  async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function resetUploadForm() {
    if (fileRef.current) fileRef.current.value = "";
    setPendingFile(null);
    setPreview(null);
    setIsComplementary(false);
    setMunicipalityId("");
    setAgendaId("");
  }

  async function doUpload(file: File, resolvedMunicipalityId: string, resolvedAgendaId: string) {
    setUploading(true);
    setError(null);
    try {
      await api.post("/api/lists", {
        municipalityId: Number(resolvedMunicipalityId),
        agendaId: resolvedAgendaId ? Number(resolvedAgendaId) : null,
        isComplementary,
        originalName: file.name,
        mimeType: file.type || "application/pdf",
        fileBase64: await fileToBase64(file),
      });
      resetUploadForm();
      lists.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  /**
   * Ao escolher o arquivo: lê na hora (rápido, local, sem IA) e sugere
   * município/agenda. Some dá pra completar sozinho, o resto fica pra
   * equipe conferir e apertar "Enviar lista" — nunca sobe nada sem esse
   * passo, mesmo quando tudo bate automaticamente.
   */
  async function handleFileSelected(file: File) {
    if (file.size > MAX_BYTES) {
      setError("Arquivo maior que 20 MB. Divida em partes.");
      return;
    }

    setPendingFile(file);
    setError(null);
    setPreview(null);
    setPreviewing(true);
    try {
      const { preview: result } = await api.post<{ preview: ListPreview }>("/api/lists/preview", {
        mimeType: file.type || "application/pdf",
        fileBase64: await fileToBase64(file),
      });
      setPreview(result);

      if (result.suggestedMunicipalityId) setMunicipalityId(String(result.suggestedMunicipalityId));
      if (result.suggestedAgendaId) setAgendaId(String(result.suggestedAgendaId));

      if (!result.suggestedMunicipalityId && result.parsed.municipality) {
        setMunicipalityForm({ name: toTitleCase(result.parsed.municipality) });
        setMunicipalityModalOpen(true);
      }

      if (result.needsAgendaConfirmation) {
        setAgendaForm({
          doctorId: result.suggestedDoctorId ? String(result.suggestedDoctorId) : "",
          unitId: result.suggestedUnitId ? String(result.suggestedUnitId) : "",
          procedureId: result.suggestedProcedureId ? String(result.suggestedProcedureId) : "",
          date: result.parsed.firstScheduledAt?.slice(0, 10) ?? "",
          shift: "INTEGRAL",
          capacity: "",
        });
        setAgendaModalOpen(true);
      }
    } catch (err) {
      // Preview é só uma ajuda — se falhar (formato não reconhecido, etc.),
      // a equipe ainda preenche os campos e envia manualmente, como antes.
      // Mas o erro precisa aparecer: antes ficava silencioso e parecia só
      // "não preencheu município sozinho" sem explicação nenhuma.
      setPreview(null);
      setError(
        err instanceof Error
          ? `Não consegui pré-ler o PDF (${err.message}). Preencha os campos manualmente.`
          : "Não consegui pré-ler o PDF. Preencha os campos manualmente."
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmMunicipality() {
    if (!municipalityForm.name.trim()) {
      setMunicipalityError("Nome é obrigatório.");
      return;
    }
    setMunicipalityBusy(true);
    setMunicipalityError(null);
    try {
      const { municipality } = await api.post<{ municipality: { id: number } }>("/api/catalog/municipalities", {
        name: municipalityForm.name.trim(),
      });
      setMunicipalityId(String(municipality.id));
      setMunicipalityModalOpen(false);
      await municipalities.reload();

      // O preview não verificou agenda pra esse município (ele nem existia
      // ainda) — refaz essa checagem na mão, contra as agendas já
      // carregadas, pra saber se ainda falta o popup de agenda.
      const firstScheduledAt = preview?.parsed.firstScheduledAt;
      const suggestedDoctorName = doctors.data?.doctors.find((d) => d.id === preview?.suggestedDoctorId)?.name;
      if (preview?.suggestedDoctorId && firstScheduledAt && suggestedDoctorName) {
        const existingAgenda = (agendas.data?.agendas ?? []).find(
          (agenda) =>
            agenda.municipalityId === municipality.id &&
            agenda.doctor.name === suggestedDoctorName &&
            agenda.date.slice(0, 10) === firstScheduledAt.slice(0, 10)
        );
        if (existingAgenda) {
          setAgendaId(String(existingAgenda.id));
        } else {
          setAgendaForm({
            doctorId: String(preview.suggestedDoctorId),
            unitId: preview.suggestedUnitId ? String(preview.suggestedUnitId) : "",
            procedureId: preview.suggestedProcedureId ? String(preview.suggestedProcedureId) : "",
            date: firstScheduledAt.slice(0, 10),
            shift: "INTEGRAL",
            capacity: "",
          });
          setAgendaModalOpen(true);
        }
      }
    } catch (err) {
      setMunicipalityError(err instanceof Error ? err.message : "Falha ao cadastrar o município.");
    } finally {
      setMunicipalityBusy(false);
    }
  }

  async function confirmAgenda() {
    if (!agendaForm.doctorId || !agendaForm.date) {
      setAgendaError("Médico e data são obrigatórios.");
      return;
    }
    setAgendaBusy(true);
    setAgendaError(null);
    try {
      const { agenda } = await api.post<{ agenda: { id: number } }>("/api/agendas", {
        doctorId: Number(agendaForm.doctorId),
        municipalityId: Number(municipalityId),
        unitId: agendaForm.unitId ? Number(agendaForm.unitId) : null,
        procedureId: agendaForm.procedureId ? Number(agendaForm.procedureId) : null,
        date: agendaForm.date,
        shift: agendaForm.shift,
        capacity: agendaForm.capacity ? Number(agendaForm.capacity) : null,
      });
      setAgendaId(String(agenda.id));
      setAgendaModalOpen(false);
      agendas.reload();
    } catch (err) {
      setAgendaError(err instanceof Error ? err.message : "Falha ao criar a agenda.");
    } finally {
      setAgendaBusy(false);
    }
  }

  async function handleSubmit() {
    if (!pendingFile) {
      setError("Escolha o arquivo antes de enviar.");
      return;
    }
    if (!municipalityId) {
      setError("Escolha o município antes de enviar.");
      return;
    }
    if (isComplementary && !agendaId) {
      setError("Lista complementar precisa estar vinculada a uma agenda — é o que garante o disparo só pras vagas abertas.");
      return;
    }
    await doUpload(pendingFile, municipalityId, agendaId);
  }

  return (
    <>
      <PageHeader
        eyebrow="Entrada"
        title="Listas"
        description="Cada arquivo recebido de uma prefeitura vira uma lista: leitura automática, revisão da equipe e só então o disparo."
      />

      <div className="card mb-6 p-5">
        <p className="eyebrow">Enviar lista</p>

        <div className="mt-3">
          <Field
            label="Arquivo"
            hint="PDF da agenda gerado pelo SISREG ou CELK, até 20 MB. Escolher o arquivo já tenta preencher o resto sozinho."
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="field"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFileSelected(file);
              }}
            />
          </Field>
        </div>

        {previewing && <p className="mt-3 text-sm text-ink-muted">Lendo o arquivo…</p>}
        {preview && !previewing && (
          <p className="mt-3 text-sm text-ink-muted">
            {preview.sourceFormat === "OUTRO"
              ? "Formato não reconhecido — confira ou preencha os campos abaixo à mão."
              : `Formato ${preview.sourceFormat} reconhecido, ${preview.rowCount} paciente(s). Confira os campos abaixo antes de enviar.`}
          </p>
        )}

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
                : "Opcional — liga a sugestão de confirmações e o endereço da unidade à mensagem."
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

        {agendaId && (
          <div className="mt-3 rounded-lg border-l-4 px-4 py-3 text-sm" style={
            unitMismatch
              ? { background: "var(--mark-yellow-soft)", borderColor: "var(--mark-yellow)" }
              : { background: "var(--sheet-2, var(--sheet))", borderColor: "var(--ink-faint)" }
          }>
            <p>
              <span className="text-ink-muted">Endereço que vai na mensagem: </span>
              {selectedAgenda?.unit
                ? `${selectedAgenda.unit.name} — ${selectedAgenda.unit.address ?? "sem endereço cadastrado"}`
                : "agenda sem unidade cadastrada — mensagem sai só com o município"}
            </p>
            {unitMismatch && (
              <p className="mt-1 font-medium">
                O PDF leu unidade "{pdfExecutingUnit}", diferente da unidade dessa agenda. Confira se é a agenda
                certa antes de enviar — dá pra corrigir a unidade em Configurações → Agendas.
              </p>
            )}
          </div>
        )}

        <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={isComplementary}
            onChange={(event) => setIsComplementary(event.target.checked)}
          />
          Esta é uma lista complementar (reposição de vagas abertas de uma agenda já disparada)
        </label>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!pendingFile || uploading || previewing}
            onClick={() => void handleSubmit()}
          >
            {uploading ? "Enviando…" : "Enviar lista"}
          </button>
        </div>

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

      <FormModal
        open={municipalityModalOpen}
        title="Cadastrar município"
        description={
          preview?.parsed.municipality
            ? `O arquivo indica o município "${preview.parsed.municipality}", mas ele ainda não está cadastrado. Confirme o nome e cadastre antes de continuar.`
            : "Município não cadastrado. Confirme o nome e cadastre antes de continuar."
        }
        submitLabel="Cadastrar e continuar"
        busy={municipalityBusy}
        error={municipalityError}
        onSubmit={confirmMunicipality}
        onCancel={() => setMunicipalityModalOpen(false)}
      >
        <Field label="Nome">
          <input
            type="text"
            className="field"
            value={municipalityForm.name}
            onChange={(event) => setMunicipalityForm({ name: event.target.value })}
            required
          />
        </Field>
      </FormModal>

      <FormModal
        open={agendaModalOpen}
        title="Confirmar agenda desta lista"
        description={
          preview?.parsed.doctor
            ? `O arquivo indica ${preview.parsed.doctor}${preview.parsed.executingUnit ? ` em ${preview.parsed.executingUnit}` : ""}, mas não existe agenda cadastrada pra essa data. Confirme (ou complete) antes de enviar — é o vínculo que dá o endereço pra mensagem de WhatsApp.`
            : "Não existe agenda cadastrada pra essa data. Confirme antes de enviar."
        }
        submitLabel="Confirmar e continuar"
        busy={agendaBusy}
        error={agendaError}
        onSubmit={confirmAgenda}
        onCancel={() => setAgendaModalOpen(false)}
      >
        <Field label="Médico">
          <select
            className="field"
            value={agendaForm.doctorId}
            onChange={(event) => setAgendaForm({ ...agendaForm, doctorId: event.target.value })}
            required
          >
            <option value="">Selecione…</option>
            {doctors.data?.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unidade" hint="Dá o endereço que entra na mensagem de WhatsApp.">
          <select
            className="field"
            value={agendaForm.unitId}
            onChange={(event) => setAgendaForm({ ...agendaForm, unitId: event.target.value })}
          >
            <option value="">Não especificada</option>
            {agendaModalUnitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
                {!unit.address ? " (sem endereço cadastrado)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Procedimento" hint="Opcional — deixe em branco se a agenda cobre vários.">
          <select
            className="field"
            value={agendaForm.procedureId}
            onChange={(event) => setAgendaForm({ ...agendaForm, procedureId: event.target.value })}
          >
            <option value="">Não especificado</option>
            {procedures.data?.procedures.map((procedure) => (
              <option key={procedure.id} value={procedure.id}>
                {procedure.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Data">
            <input
              type="date"
              className="field"
              value={agendaForm.date}
              onChange={(event) => setAgendaForm({ ...agendaForm, date: event.target.value })}
              required
            />
          </Field>
          <Field label="Turno">
            <select
              className="field"
              value={agendaForm.shift}
              onChange={(event) => setAgendaForm({ ...agendaForm, shift: event.target.value })}
            >
              <option value="MANHA">Manhã</option>
              <option value="TARDE">Tarde</option>
              <option value="INTEGRAL">Dia todo</option>
            </select>
          </Field>
          <Field label="Capacidade">
            <input
              type="number"
              min={1}
              className="field"
              value={agendaForm.capacity}
              onChange={(event) => setAgendaForm({ ...agendaForm, capacity: event.target.value })}
            />
          </Field>
        </div>
      </FormModal>

      {lists.loading && <Spinner />}
      {lists.error && <ErrorNote message={lists.error} />}

      {lists.data?.lists.length === 0 && !lists.loading && (
        <EmptyState
          title="Nenhuma lista ainda"
          description="Envie o PDF da agenda acima. O sistema lê o arquivo e deixa tudo pronto para a equipe conferir antes de qualquer disparo."
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
