import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { StatusBand } from "../components/StatusBand";
import { Callout, ErrorNote, Spinner, StatusPill, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime, formatPhone, LIST_STATUS_LABEL, toBandCounts } from "../lib/format";

/*
  Tela de revisão: a etapa obrigatória entre a leitura automática e o disparo.

  O arquivo original fica ao lado da tabela porque conferir de memória não
  funciona — a equipe precisa ver a linha impressa e o que o sistema entendeu
  ao mesmo tempo.
*/

interface Appointment {
  id: number;
  scheduledAt: string;
  status: string;
  selectedPhone: string | null;
  phones: string[];
  extractionConfidence: number | null;
  manuallyEdited: boolean;
  isFirstVisit: boolean | null;
  patient: { id: number; name: string; cns: string | null; phones: string[]; optedOut: boolean };
  doctor: { id: number; name: string };
  procedure: { id: number; name: string };
  requestingUnit: { id: number; name: string } | null;
  rawLine: { issues?: string[]; invalidPhones?: string[]; notes?: string | null } | null;
}

interface ListSuggestion {
  stillNeeded: number;
  confirmationsNeeded: number;
  explanation: string;
  doctorName: string;
  expectedPerDay: number;
}

interface UnitCheck {
  agendaUnit: { id: number; name: string; address: string | null } | null;
  pdfUnit: string | null;
  missingAddress: boolean;
  mismatch: boolean;
  noAgenda: boolean;
}

interface ListDetail {
  list: {
    id: number;
    originalName: string;
    mimeType: string;
    sourceFormat: string;
    status: string;
    extractionError: string | null;
    municipality: { id: number; name: string };
    agenda: { id: number; date: string; unit: { id: number; name: string; address: string | null } | null } | null;
  };
  appointments: Appointment[];
  warnings: string[];
  unitCheck: UnitCheck;
}

const ISSUE_LABEL: Record<string, string> = {
  sem_telefone: "sem telefone",
  telefone_invalido: "telefone inválido",
  baixa_confianca: "leitura duvidosa",
  sem_data: "sem data",
  sem_procedimento: "sem procedimento",
  sem_medico: "sem médico",
  duplicado: "duplicado",
};

export function Revisao() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useApi<ListDetail>(id ? `/api/lists/${id}` : null, [id]);
  const suggestion = useApi<{ suggestion: ListSuggestion | null }>(
    id ? `/api/suggestions/list/${id}` : null,
    [id]
  );

  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ name: string; phone: string; scheduledAt: string }>({
    name: "",
    phone: "",
    scheduledAt: "",
  });
  const [removing, setRemoving] = useState<Appointment | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "approve" | "dispatch" | "conclude" | "reprocess" | "delete" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Precisa ser marcado antes de aprovar sempre que o comparativo de
  // unidade/endereço acusa algum problema — força a equipe a olhar em vez
  // de só clicar "aprovar" sem reparar no aviso.
  const [unitConfirmed, setUnitConfirmed] = useState(false);

  // Enquanto a extração roda em segundo plano (EXTRAINDO), o status só muda
  // sozinho no banco — sem isso a tela ficava presa até a equipe apertar F5.
  const extracting = detail.data?.list.status === "EXTRAINDO";
  useEffect(() => {
    if (!extracting) return;
    const interval = setInterval(() => detail.reload(), 3000);
    return () => clearInterval(interval);
  }, [extracting, detail.reload]);

  if (detail.loading) return <Spinner label="Carregando a lista…" />;
  if (detail.error) return <ErrorNote message={detail.error} />;
  if (!detail.data) return null;

  const { list, appointments, warnings, unitCheck } = detail.data;
  const counts: Record<string, number> = {};
  for (const appointment of appointments) {
    counts[appointment.status] = (counts[appointment.status] ?? 0) + 1;
  }
  const hasUnitIssue = unitCheck.noAgenda || !unitCheck.agendaUnit || unitCheck.missingAddress || unitCheck.mismatch;
  // O comparativo de unidade abaixo já cobre esses avisos de forma mais
  // clara (lado a lado) — não repetir na lista genérica de avisos da leitura.
  const otherWarnings = warnings.filter(
    (warning) => !warning.includes("nidade") && !warning.includes("endereço") && !warning.includes("agenda vinculada")
  );

  // Busca por nome (parcial, sem acento/caixa) ou telefone (só os dígitos,
  // compara contra qualquer telefone conhecido do paciente, não só o
  // selecionado — a equipe pode estar procurando pelo número 2 ou 3).
  const searchDigits = search.replace(/\D/g, "");
  const searchName = search.trim().toLocaleLowerCase("pt-BR");
  const filteredAppointments = appointments.filter((appointment) => {
    if (onlyIssues && (appointment.rawLine?.issues?.length ?? 0) === 0) return false;
    if (!searchName) return true;
    const nameMatch = appointment.patient.name.toLocaleLowerCase("pt-BR").includes(searchName);
    const phoneMatch = searchDigits.length > 0 && appointment.phones.some((phone) => phone.includes(searchDigits));
    return nameMatch || phoneMatch;
  });

  const pending = appointments.filter(
    (appointment) => (appointment.rawLine?.issues?.length ?? 0) > 0
  ).length;
  const isReviewing = list.status === "EM_REVISAO";

  function startEdit(appointment: Appointment) {
    setEditing(appointment.id);
    setDraft({
      name: appointment.patient.name,
      phone: appointment.selectedPhone ?? "",
      // datetime-local exige o formato AAAA-MM-DDTHH:MM sem fuso. timeZone
      // explícito é obrigatório — não pode depender do fuso do computador
      // de quem está editando (achado em 2026-08-25, mesmo problema do
      // parsing no backend, ver lib/timezone.ts).
      scheduledAt: new Date(appointment.scheduledAt)
        .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
        .slice(0, 16)
        .replace(" ", "T"),
    });
  }

  async function saveEdit(appointmentId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/lists/appointments/${appointmentId}`, {
        patientName: draft.name,
        selectedPhone: draft.phone || null,
        scheduledAt: draft.scheduledAt,
      });
      setEditing(null);
      detail.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.delete(`/api/lists/appointments/${removing.id}`);
      setRemoving(null);
      detail.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remover.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmAction() {
    setBusy(true);
    setError(null);
    try {
      if (confirmAction === "delete") {
        await api.delete(`/api/lists/${list.id}`);
        navigate("/listas");
        return;
      } else if (confirmAction === "approve") {
        await api.post(`/api/lists/${list.id}/approve`, { confirmUnitMismatch: unitConfirmed });
        setNotice("Lista aprovada. Agora dá para disparar as confirmações.");
      } else if (confirmAction === "reprocess") {
        await api.post(`/api/lists/${list.id}/reprocess`);
        setNotice("Reprocessando a lista…");
      } else if (confirmAction === "dispatch") {
        const result = await api.post<{
          queued: number;
          skipped: number;
          sent: number;
          failed: number;
          deferred: number;
          capacity: { remaining: number };
        }>(`/api/lists/${list.id}/dispatch`);
        setNotice(
          `${result.sent} mensagens enviadas` +
            (result.failed > 0 ? `, ${result.failed} falharam` : "") +
            (result.skipped > 0 ? `. ${result.skipped} ignoradas (opt-out ou já enfileiradas)` : "") +
            (result.deferred > 0
              ? `. ${result.deferred} continuam na fila (limite diário) — saem quando rodar a cadência de novo.`
              : ".") +
            ` Cabem mais ${result.capacity.remaining} envios hoje.`
        );
      } else {
        await api.post(`/api/lists/${list.id}/conclude`);
        setNotice("Lista concluída. Baixe o relatório em \"Exportar\" para enviar à secretaria.");
      }
      setConfirmAction(null);
      detail.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na ação.");
      setConfirmAction(null);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Atualiza a lista sem o spinner de página inteira (`detail.reload()`
   * troca `loading` pra `true` e substitui a tela toda) — só pra conferir
   * se chegou confirmação nova depois do disparo, sem perder o lugar na
   * tabela nem a busca em andamento.
   */
  async function handleRefresh() {
    if (!id) return;
    setRefreshing(true);
    setError(null);
    try {
      const [listResult, suggestionResult] = await Promise.all([
        api.get<ListDetail>(`/api/lists/${id}`),
        api.get<{ suggestion: ListSuggestion | null }>(`/api/suggestions/list/${id}`),
      ]);
      detail.setData(listResult);
      suggestion.setData(suggestionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`${list.municipality.name} · ${list.sourceFormat}`}
        title={list.originalName}
        description={`${appointments.length} pacientes · ${LIST_STATUS_LABEL[list.status] ?? list.status}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => navigate("/listas")}>
              Voltar
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
              title="Conferir se chegou confirmação nova, sem sair da tela"
            >
              {refreshing ? "Atualizando…" : "Atualizar"}
            </button>
            <a className="btn btn-quiet" href={`/api/indicators/list-report?listId=${list.id}`}>
              Exportar
            </a>
            {list.status !== "DISPARADA" && list.status !== "CONCLUIDA" && (
              <button
                type="button"
                className="btn btn-quiet"
                style={{ color: "var(--mark-red)" }}
                onClick={() => setConfirmAction("delete")}
              >
                Excluir lista
              </button>
            )}
            {list.status === "ERRO" && (
              <button type="button" className="btn btn-primary" onClick={() => setConfirmAction("reprocess")}>
                Tentar novamente
              </button>
            )}
            {isReviewing && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={hasUnitIssue && !unitConfirmed}
                title={hasUnitIssue && !unitConfirmed ? "Confirme o comparativo de unidade/endereço abaixo antes de aprovar." : undefined}
                onClick={() => setConfirmAction("approve")}
              >
                Aprovar lista
              </button>
            )}
            {list.status === "APROVADA" && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={hasUnitIssue && !unitConfirmed}
                title={hasUnitIssue && !unitConfirmed ? "Confirme o comparativo de unidade/endereço abaixo antes de disparar." : undefined}
                onClick={() => setConfirmAction("dispatch")}
              >
                Disparar confirmações
              </button>
            )}
            {list.status === "DISPARADA" && (
              <button type="button" className="btn btn-primary" onClick={() => setConfirmAction("conclude")}>
                Concluir e enviar relatório
              </button>
            )}
          </div>
        }
      />

      {notice && (
        <div className="mb-4">
          <Callout>{notice}</Callout>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {hasUnitIssue && (isReviewing || list.status === "APROVADA") && (
        <div className="mb-4">
          <Callout tone="warn">
            <p className="font-semibold">
              {unitCheck.noAgenda
                ? "Lista sem agenda vinculada."
                : !unitCheck.agendaUnit
                  ? "A agenda vinculada não tem unidade cadastrada."
                  : unitCheck.mismatch
                    ? "A unidade lida no PDF não bate com a unidade da agenda vinculada."
                    : "A unidade da agenda vinculada não tem endereço cadastrado."}
            </p>
            {unitCheck.agendaUnit || unitCheck.pdfUnit ? (
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-ink-muted">PDF diz:</dt>
                <dd>{unitCheck.pdfUnit ?? "(não leu unidade nenhuma)"}</dd>
                <dt className="text-ink-muted">
                  Cadastro diz <span className="font-semibold text-ink">(vai pra mensagem)</span>:
                </dt>
                <dd>
                  {unitCheck.agendaUnit
                    ? `${unitCheck.agendaUnit.name} — ${unitCheck.agendaUnit.address ?? "sem endereço cadastrado"}`
                    : "(agenda sem unidade)"}
                </dd>
              </dl>
            ) : null}
            <p className="mt-2 text-sm">
              É esse endereço cadastrado que vai para a mensagem de WhatsApp. Se estiver errado, corrija a unidade
              da agenda em Configurações → Agendas antes de aprovar.
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={unitConfirmed}
                onChange={(event) => setUnitConfirmed(event.target.checked)}
              />
              Conferi e confirmo que a unidade/endereço estão corretos (ou sei que vão sair incompletos).
            </label>
          </Callout>
        </div>
      )}

      {otherWarnings.length > 0 && (
        <div className="mb-4">
          <Callout tone="warn">
            <p className="font-semibold">A leitura deixou avisos:</p>
            <ul className="mt-1 list-inside list-disc">
              {otherWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Callout>
        </div>
      )}

      {suggestion.data?.suggestion && (
        <div className="mb-4">
          <Callout>{suggestion.data.suggestion.explanation}</Callout>
        </div>
      )}

      <div className="card mb-5 p-5">
        <StatusBand counts={toBandCounts(counts)} />
        {pending > 0 && isReviewing && (
          <p className="mt-3 text-sm text-ink-muted">
            <span className="font-semibold text-ink">{pending}</span> de {appointments.length} linhas
            precisam de conferência antes do disparo.
          </p>
        )}
      </div>

      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="field max-w-sm"
            placeholder="Buscar por nome ou telefone…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            onClick={() => setOnlyIssues((prev) => !prev)}
            aria-pressed={onlyIssues}
            className={`btn px-3 py-1.5 text-sm ${onlyIssues ? "btn-primary" : "btn-quiet"}`}
          >
            Filtrar erros{pending > 0 ? ` (${pending})` : ""}
          </button>
        </div>
        {(search || onlyIssues) && (
          <p className="mt-1 text-xs text-ink-faint">
            {filteredAppointments.length} de {appointments.length} pacientes
          </p>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_minmax(320px,420px)]">
        <div className="min-w-0">
          <Table
            head={
              <tr>
                <Th>Paciente</Th>
                <Th>Telefone</Th>
                <Th>Data e hora</Th>
                <Th>Procedimento</Th>
                <Th>Situação</Th>
                {isReviewing && <Th align="right">Ações</Th>}
              </tr>
            }
          >
            {filteredAppointments.map((appointment) => {
              const issues = appointment.rawLine?.issues ?? [];
              const isEditing = editing === appointment.id;
              return (
                <tr
                  key={appointment.id}
                  style={issues.length > 0 ? { background: "var(--mark-yellow-soft)" } : undefined}
                >
                  <Td>
                    {isEditing ? (
                      <input
                        className="field"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    ) : (
                      <>
                        <span className="font-medium">{appointment.patient.name}</span>
                        {appointment.patient.optedOut && (
                          <span className="ml-2 text-xs text-mark-red">não quer receber</span>
                        )}
                        {appointment.manuallyEdited && (
                          <span className="ml-2 text-xs text-ink-faint">corrigido</span>
                        )}
                        {issues.length > 0 && (
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {issues.map((issue) => ISSUE_LABEL[issue] ?? issue).join(" · ")}
                          </p>
                        )}
                        {appointment.rawLine?.notes && (
                          <p className="mt-0.5 text-xs italic text-ink-faint">
                            {appointment.rawLine.notes}
                          </p>
                        )}
                      </>
                    )}
                  </Td>
                  <Td muted>
                    {isEditing ? (
                      <input
                        className="field"
                        value={draft.phone}
                        placeholder="(47) 99999-9999"
                        onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                      />
                    ) : (
                      <>
                        <span className="tabular">{formatPhone(appointment.selectedPhone)}</span>
                        {appointment.phones.length > 1 && (
                          <p className="text-xs text-ink-faint">+{appointment.phones.length - 1} outro(s)</p>
                        )}
                        {(appointment.rawLine?.invalidPhones?.length ?? 0) > 0 && (
                          <p className="text-xs text-mark-red">
                            inválido: {appointment.rawLine?.invalidPhones?.join(", ")}
                          </p>
                        )}
                      </>
                    )}
                  </Td>
                  <Td muted>
                    {isEditing ? (
                      <input
                        type="datetime-local"
                        className="field"
                        value={draft.scheduledAt}
                        onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })}
                      />
                    ) : (
                      formatDateTime(appointment.scheduledAt)
                    )}
                  </Td>
                  <Td muted>
                    {appointment.procedure.name}
                    <p className="text-xs text-ink-faint">{appointment.doctor.name}</p>
                  </Td>
                  <Td>
                    <StatusPill status={appointment.status} />
                    {appointment.extractionConfidence !== null &&
                      appointment.extractionConfidence < 0.8 && (
                        <p className="tabular mt-0.5 text-xs text-ink-faint">
                          confiança {appointment.extractionConfidence.toFixed(2)}
                        </p>
                      )}
                  </Td>
                  {isReviewing && (
                    <Td align="right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn btn-primary px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() => void saveEdit(appointment.id)}
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet px-2 py-1 text-xs"
                            onClick={() => setEditing(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn btn-quiet px-2 py-1 text-xs"
                            onClick={() => startEdit(appointment)}
                          >
                            Corrigir
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet px-2 py-1 text-xs"
                            onClick={() => setRemoving(appointment)}
                          >
                            Remover
                          </button>
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </Table>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <p className="eyebrow mb-2">Arquivo original</p>
          <div className="card overflow-hidden" style={{ height: "70vh" }}>
            {list.mimeType === "application/pdf" ? (
              <iframe
                title="Arquivo original da lista"
                src={`/api/lists/${list.id}/file`}
                className="h-full w-full"
              />
            ) : (
              <img
                src={`/api/lists/${list.id}/file`}
                alt="Foto da lista recebida"
                className="h-full w-full object-contain"
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={removing !== null}
        title="Remover este paciente da lista?"
        description={`${removing?.patient.name ?? ""} sai da lista e não recebe mensagem. Use para duplicidade ou linha que não é desta agenda.`}
        confirmLabel="Remover"
        danger
        busy={busy}
        onConfirm={handleRemove}
        onCancel={() => setRemoving(null)}
      />

      <ConfirmModal
        open={confirmAction !== null}
        title={
          confirmAction === "delete"
            ? "Excluir esta lista?"
            : confirmAction === "approve"
              ? "Aprovar a lista?"
              : confirmAction === "reprocess"
                ? "Tentar a leitura de novo?"
                : confirmAction === "dispatch"
                  ? "Disparar as confirmações?"
                  : "Concluir esta lista?"
        }
        description={
          confirmAction === "delete"
            ? `"${list.originalName}" e todos os agendamentos dela somem, sem volta. Como ainda não foi disparada, nenhuma mensagem de WhatsApp foi enviada — nada se perde do lado do paciente.`
            : confirmAction === "approve"
              ? "Depois de aprovada a revisão fecha e os dados não podem mais ser corrigidos aqui."
              : confirmAction === "reprocess"
                ? "A leitura automática roda de novo do zero — qualquer correção feita manualmente nesta lista se perde."
                : confirmAction === "dispatch"
                  ? `As mensagens são enviadas na hora, respeitando o limite diário da Meta — o que não couber fica na fila pro próximo envio. ${
                      pending > 0 ? `Atenção: ${pending} linhas ainda estão marcadas para conferência.` : ""
                    }`
                  : "Marca a lista como encerrada. O relatório com o resultado de cada paciente continua disponível em \"Exportar\" para enviar à secretaria manualmente."
        }
        confirmLabel={
          confirmAction === "delete"
            ? "Excluir"
            : confirmAction === "approve"
              ? "Aprovar"
              : confirmAction === "reprocess"
                ? "Tentar novamente"
                : confirmAction === "dispatch"
                  ? "Disparar"
                  : "Concluir"
        }
        danger={confirmAction === "delete"}
        busy={busy}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}
