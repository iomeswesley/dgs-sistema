import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { FormModal } from "../components/FormModal";
import { StatusBand } from "../components/StatusBand";
import { Callout, ErrorNote, Field, Spinner, StatusPill, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime, formatPhone, LIST_STATUS_LABEL, STATUS_LABEL, toBandCounts } from "../lib/format";
import { runQueueUntilDone } from "../lib/queue";

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
  /** Outro celular do cadastro, diferente do selecionado — sugestão pronta pro reenvio. */
  alternatePhone: string | null;
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

// Filtro por situação do envio — mesma dinâmica de botões do Cancelamento
// (2026-08-26). Ordem pensada pro fluxo: primeiro quem ainda não recebeu
// nada, depois quem recebeu, depois os dois desfechos finais.
const STATUS_FILTER_OPTIONS = [
  "PENDENTE",
  "ENVIADO",
  "ENTREGUE",
  "CONFIRMADO",
  "RECUSADO",
  "SEM_RESPOSTA",
  "SEM_TELEFONE",
  "FALHA",
] as const;

interface CatalogDoctor {
  id: number;
  name: string;
  active: boolean;
}
interface CatalogProcedure {
  id: number;
  name: string;
  active: boolean;
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

interface UnrecognizedGuess {
  rawText: string;
  name: string | null;
  cns: string | null;
  birthDate: string | null;
  phones: string[];
}

interface MessagePreview {
  template: "CONFIRMACAO" | "VAGA_ABERTA";
  text: string;
  patientName: string;
  phone: string | null;
  totalPatients: number;
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
  unrecognized: UnrecognizedGuess[];
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

// Legenda do que cada situação quer dizer — mesmo pedido/padrão da tela de
// Cancelamento (2026-08-26), pra não depender de perguntar toda vez.
const STATUS_EXPLANATION: { status: string; text: string }[] = [
  { status: "PENDENTE", text: "Ainda não entrou na fila de envio, ou está esperando a próxima rodada." },
  { status: "ENVIADO", text: "Saiu do nosso número, ainda sem confirmação de entrega." },
  { status: "ENTREGUE", text: "Chegou no celular do paciente. Não significa que ele já respondeu." },
  { status: "CONFIRMADO", text: "O paciente respondeu confirmando presença." },
  { status: "RECUSADO", text: "O paciente respondeu que não vai comparecer." },
  { status: "SEM_RESPOSTA", text: "Chegou, mas o paciente não respondeu dentro do prazo — fechado automaticamente." },
  { status: "SEM_TELEFONE", text: "O cadastro não tem nenhum número válido — nunca chegou a ser tentado. Use \"Reenviar\" pra completar o telefone." },
  { status: "FALHA", text: "Não chegou — na prática, quase sempre número sem WhatsApp, inválido ou inalcançável." },
  { status: "CANCELADO", text: "A agenda inteira foi cancelada pela equipe (módulo de Cancelamento), não depende de resposta do paciente." },
];

export function Revisao() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useApi<ListDetail>(id ? `/api/lists/${id}` : null, [id]);
  const suggestion = useApi<{ suggestion: ListSuggestion | null }>(
    id ? `/api/suggestions/list/${id}` : null,
    [id]
  );

  const doctorsData = useApi<{ doctors: CatalogDoctor[] }>("/api/catalog/doctors");
  const proceduresData = useApi<{ procedures: CatalogProcedure[] }>("/api/catalog/procedures");

  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    patientName: "",
    cns: "",
    phone: "",
    scheduledAt: "",
    doctorId: "",
    procedureId: "",
    isFirstVisit: false,
  });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addRawText, setAddRawText] = useState<string | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryPhones, setRetryPhones] = useState<Record<number, string>>({});
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  // Corrigir telefone de UM paciente, em qualquer situação — não só quem
  // falhou. Caso real (2026-08-27): mensagem foi entregue certinho, só que
  // pro número errado (não era do paciente); a pessoa que atendeu respondeu
  // avisando o número certo, mas como o status não era FALHA/SEM_TELEFONE,
  // não tinha jeito nenhum de corrigir e reenviar depois do disparo — só
  // "Reenviar pra quem falhou" (restrito) e "Corrigir" (só em EM_REVISAO).
  const [quickFixTarget, setQuickFixTarget] = useState<Appointment | null>(null);
  const [quickFixPhone, setQuickFixPhone] = useState("");
  const [quickFixBusy, setQuickFixBusy] = useState(false);
  const [quickFixError, setQuickFixError] = useState<string | null>(null);
  // Prévia da mensagem de verdade (já com as variáveis preenchidas) do
  // primeiro paciente, antes de aprovar — pedido do usuário em 2026-08-27:
  // o comparativo de unidade/endereço já existia, mas era abstrato; agora
  // dá pra ver a mensagem exata que vai sair, com nome/data/procedimento/
  // endereço reais, antes de confirmar "Aprovar".
  const [approvePreviewOpen, setApprovePreviewOpen] = useState(false);
  const [approvePreview, setApprovePreview] = useState<MessagePreview | null>(null);
  const [approvePreviewLoading, setApprovePreviewLoading] = useState(false);
  const [approvePreviewError, setApprovePreviewError] = useState<string | null>(null);
  // Resumo "quem ainda não respondeu" — cada linha age na hora (Sim/Não),
  // sem formulário nenhum; `contactBusyId` trava só a linha clicada, não a
  // lista inteira.
  const [pendingResponseOpen, setPendingResponseOpen] = useState(false);
  const [contactBusyId, setContactBusyId] = useState<number | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ name: string; phone: string; scheduledAt: string }>({
    name: "",
    phone: "",
    scheduledAt: "",
  });
  const [removing, setRemoving] = useState<Appointment | null>(null);
  const [confirmAction, setConfirmAction] = useState<"dispatch" | "conclude" | "reprocess" | "delete" | null>(null);
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

  const { list, appointments, warnings, unrecognized, unitCheck } = detail.data;
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
  // Linhas que a leitura nem conseguiu transformar em agendamento — não
  // contam em `counts` (não são Appointment), mas também "precisam de
  // ação": aparecem somadas à faixa "Precisa de ação" do StatusBand.
  const unrecognizedCount = otherWarnings.filter((w) => w.includes("Registro não reconhecido")).length;

  // Busca por nome (parcial, sem acento/caixa) ou telefone (só os dígitos,
  // compara contra qualquer telefone conhecido do paciente, não só o
  // selecionado — a equipe pode estar procurando pelo número 2 ou 3).
  const searchDigits = search.replace(/\D/g, "");
  const searchName = search.trim().toLocaleLowerCase("pt-BR");
  const filteredAppointments = appointments.filter((appointment) => {
    if (onlyIssues && (appointment.rawLine?.issues?.length ?? 0) === 0) return false;
    if (statusFilter && appointment.status !== statusFilter) return false;
    if (!searchName) return true;
    const nameMatch = appointment.patient.name.toLocaleLowerCase("pt-BR").includes(searchName);
    const phoneMatch = searchDigits.length > 0 && appointment.phones.some((phone) => phone.includes(searchDigits));
    return nameMatch || phoneMatch;
  });

  const pending = appointments.filter(
    (appointment) => (appointment.rawLine?.issues?.length ?? 0) > 0
  ).length;
  const isReviewing = list.status === "EM_REVISAO";
  // Inclui SEM_TELEFONE junto com FALHA — sem telefone nenhum nunca chega
  // a entrar na fila, e depois do disparo a edição normal ("Corrigir") já
  // não é mais permitida (só funciona em EM_REVISAO). Sem isso esse
  // paciente ficava sem nenhum jeito de completar o telefone e receber a
  // mensagem depois (achado em 2026-08-26).
  const failedAppointments = appointments.filter(
    (appointment) => appointment.status === "FALHA" || appointment.status === "SEM_TELEFONE"
  );

  // Chegou (ou pelo menos saiu) mas ainda sem resposta nenhuma — o "resumo
  // pra ligar" que a equipe pediu em 2026-08-27: quem já devia ter visto a
  // mensagem, mas nem clicou Sim/Não nem escreveu nada. ENVIADO/ENTREGUE
  // porque não dá pra saber, do lado de cá, se o paciente já leu ou não —
  // só que a Meta não reportou clique nenhum ainda.
  const pendingResponseAppointments = appointments.filter(
    (appointment) => appointment.status === "ENVIADO" || appointment.status === "ENTREGUE"
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
      const result = await api.post<{ queued: number }>(`/api/lists/${list.id}/retry-failed`, { updates });
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

  function openQuickFix(appointment: Appointment) {
    setQuickFixTarget(appointment);
    setQuickFixPhone(appointment.alternatePhone ?? "");
    setQuickFixError(null);
  }

  /**
   * Corrige o telefone de UM paciente e reenvia — mesma rota de "Reenviar
   * pra quem falhou" (`retry-failed`), só que pra um paciente só e
   * disponível pra qualquer situação, não só falha/sem telefone.
   */
  async function submitQuickFix() {
    if (!quickFixTarget) return;
    if (!quickFixPhone.trim()) {
      setQuickFixError("Informe o telefone novo.");
      return;
    }
    setQuickFixBusy(true);
    setQuickFixError(null);
    try {
      const result = await api.post<{ queued: number }>(`/api/lists/${list.id}/retry-failed`, {
        updates: [{ appointmentId: quickFixTarget.id, phone: quickFixPhone.trim() }],
      });
      setQuickFixTarget(null);
      setRetryNotice(`Telefone corrigido — reenviando pra ${result.queued} paciente(s)...`);
      const finished = await runQueueUntilDone(({ sent, failed }) => {
        setRetryNotice(`Reenviando... ${sent} enviada(s), ${failed} falharam.`);
      });
      setRetryNotice(
        `Reenvio concluído — ${finished.sent} enviada(s)` + (finished.failed > 0 ? `, ${finished.failed} falharam` : "") + "."
      );
      detail.reload();
    } catch (err) {
      setQuickFixError(err instanceof Error ? err.message : "Falha ao corrigir e reenviar.");
    } finally {
      setQuickFixBusy(false);
    }
  }

  async function openApprovePreview() {
    setApprovePreviewOpen(true);
    setApprovePreview(null);
    setApprovePreviewError(null);
    setApprovePreviewLoading(true);
    try {
      const result = await api.get<MessagePreview>(`/api/lists/${list.id}/message-preview`);
      setApprovePreview(result);
    } catch (err) {
      setApprovePreviewError(err instanceof Error ? err.message : "Falha ao montar a prévia da mensagem.");
    } finally {
      setApprovePreviewLoading(false);
    }
  }

  async function confirmApprove() {
    setBusy(true);
    setApprovePreviewError(null);
    try {
      await api.post(`/api/lists/${list.id}/approve`, { confirmUnitMismatch: unitConfirmed });
      setApprovePreviewOpen(false);
      setNotice("Lista aprovada. Agora dá para disparar as confirmações.");
      detail.reload();
    } catch (err) {
      setApprovePreviewError(err instanceof Error ? err.message : "Falha ao aprovar.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Registro rápido de contato por telefone — mesmo `/api/appointments/:id/
   * contact` que Acompanhamento já usa, só que direto na linha, sem modal
   * de motivo/observação: pedido do usuário em 2026-08-27 pra tocar uma
   * lista de ligações rápido (liga, pergunta, clica, próximo). Recusa sem
   * motivo específico cai em "Outro" (o backend já faz isso sozinho) — quem
   * quiser detalhar o motivo continua podendo editar depois em Acompanhamento.
   */
  async function quickContact(appointmentId: number, outcome: "CONFIRMADO" | "RECUSADO") {
    setContactBusyId(appointmentId);
    setContactError(null);
    try {
      await api.post(`/api/appointments/${appointmentId}/contact`, { outcome });
      detail.reload();
    } catch (err) {
      setContactError(err instanceof Error ? err.message : "Falha ao registrar o contato.");
    } finally {
      setContactBusyId(null);
    }
  }

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

  function openAddModal(guess?: UnrecognizedGuess) {
    // Pré-preenche médico/procedimento/data com o que o resto da lista já
    // usa — é a mesma agenda pra todo mundo, só a leitura que não conseguiu
    // ler essa linha específica. A equipe só troca se for mesmo diferente.
    // Quando vem de um "Registro não reconhecido", também pré-preenche
    // nome/CNS/telefone com o que o palpite melhor-esforço conseguiu pescar
    // do texto bruto (pedido do usuário em 2026-08-26) — nunca 100%
    // garantido, por isso o `rawText` aparece do lado pra conferir.
    const first = appointments[0];
    setAddForm({
      patientName: guess?.name ?? "",
      cns: guess?.cns ?? "",
      phone: guess?.phones[0] ?? "",
      scheduledAt: first
        ? new Date(first.scheduledAt).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 16).replace(" ", "T")
        : "",
      doctorId: first ? String(first.doctor.id) : "",
      procedureId: first ? String(first.procedure.id) : "",
      isFirstVisit: false,
    });
    setAddRawText(guess?.rawText ?? null);
    setAddError(null);
    setAddOpen(true);
  }

  async function submitAdd() {
    if (!addForm.patientName.trim() || !addForm.phone.trim() || !addForm.scheduledAt || !addForm.doctorId || !addForm.procedureId) {
      setAddError("Preencha nome, telefone, data/hora, médico e procedimento.");
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      const result = await api.post<{ appointmentId: number; queued: boolean }>(`/api/lists/${list.id}/appointments`, {
        patientName: addForm.patientName.trim(),
        cns: addForm.cns.trim() || null,
        phone: addForm.phone.trim(),
        scheduledAt: addForm.scheduledAt,
        doctorId: Number(addForm.doctorId),
        procedureId: Number(addForm.procedureId),
        isFirstVisit: addForm.isFirstVisit,
        sourceRawText: addRawText,
      });
      setAddOpen(false);
      detail.reload();
      // Lista já passou da revisão: a mensagem pra essa pessoa já foi
      // enfileirada no backend — completa o envio sozinho, mesma garantia
      // de sempre terminar sem depender do cron (ver lib/queue.ts).
      if (result.queued) {
        setNotice(`${addForm.patientName.trim()} adicionado(a) — enviando confirmação...`);
        const finished = await runQueueUntilDone(({ sent, failed }) => {
          setNotice(`${addForm.patientName.trim()} adicionado(a) — ${sent} enviada(s), ${failed} falharam.`);
        });
        setNotice(
          `${addForm.patientName.trim()} adicionado(a) — ${finished.sent > 0 ? "confirmação enviada." : finished.failed > 0 ? "falha ao enviar." : "aguardando envio."}`
        );
        detail.reload();
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Falha ao adicionar paciente.");
    } finally {
      setAddBusy(false);
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
        let sent = result.sent;
        let failed = result.failed;
        setNotice(`${sent} mensagens enviadas até agora, ${failed} falharam. Enviando o restante...`);
        // Lista grande pode não caber inteira na primeira chamada (o
        // servidor pára sozinho perto do limite de tempo da função) —
        // continua chamando sozinho até esvaziar, sem depender do cron do
        // dia seguinte pra terminar um disparo de hoje (achado em
        // 2026-08-26, ver comentário em lib/queue.ts).
        const finished = await runQueueUntilDone((progress) => {
          sent = result.sent + progress.sent;
          failed = result.failed + progress.failed;
          setNotice(`${sent} mensagens enviadas até agora, ${failed} falharam. Enviando o restante...`);
        });
        sent = result.sent + finished.sent;
        failed = result.failed + finished.failed;
        setNotice(
          `${sent} mensagens enviadas` +
            (failed > 0 ? `, ${failed} falharam` : "") +
            (result.skipped > 0 ? `. ${result.skipped} ignoradas (opt-out ou já enfileiradas)` : "") +
            (finished.remainingToday === 0 && sent + failed < result.queued
              ? " — limite diário de hoje acabou, o restante sai amanhã automaticamente."
              : ".")
        );
      } else {
        await api.post(`/api/lists/${list.id}/conclude`);
        setNotice("Lista concluída. Baixe o relatório em \"Exportar CSV\" ou \"Exportar PDF\" para enviar à secretaria.");
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
            {pendingResponseAppointments.length > 0 && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setPendingResponseOpen(true)}
                title="Quem já recebeu a mensagem mas ainda não clicou Sim/Não nem respondeu nada — pronto pra ligar"
              >
                Quem ainda não respondeu ({pendingResponseAppointments.length})
              </button>
            )}
            <a className="btn btn-quiet" href={`/api/indicators/list-report?listId=${list.id}`}>
              Exportar CSV
            </a>
            <a
              className="btn btn-quiet"
              href={`/api/indicators/list-report-pdf?listId=${list.id}`}
              title="PDF pronto pra enviar à secretaria — agrupado por situação, mesmo modelo do Cancelamento"
            >
              Exportar PDF
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
                onClick={() => void openApprovePreview()}
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
      {retryNotice && (
        <div className="mb-4">
          <Callout>{retryNotice}</Callout>
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
          <Callout tone="danger">
            <p className="font-semibold">A leitura deixou avisos:</p>
            <ul className="mt-1 list-inside list-disc">
              {otherWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>

            {unrecognized.length > 0 && (
              <div className="mt-3 space-y-2">
                {unrecognized.map((guess, i) => (
                  <div key={i} className="rounded-md bg-sheet px-3 py-2">
                    <p className="truncate text-xs italic text-ink-faint" title={guess.rawText}>
                      "{guess.rawText}"
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary mt-1.5 px-3 py-1 text-xs"
                      onClick={() => openAddModal(guess)}
                    >
                      + Adicionar {guess.name ? `"${guess.name}"` : "esse registro"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Callout>
        </div>
      )}

      {/* Sempre visível, com aviso ou sem aviso nenhum — antes só aparecia
          dentro do card de avisos da leitura, então sumia por completo numa
          lista sem nenhum problema de extração (achado pelo usuário em
          2026-08-27: "não achei esse botão"). "Adicionar paciente
          manualmente" serve pra qualquer motivo de faltar alguém na lista,
          não só pra quem a leitura não reconheceu. */}
      <div className="mb-4">
        <button type="button" className="btn btn-quiet px-3 py-1.5 text-sm" onClick={() => openAddModal()}>
          + Adicionar paciente manualmente
        </button>
        {!isReviewing && (
          <span className="ml-2 text-xs text-ink-faint">
            A lista já {list.status === "DISPARADA" || list.status === "CONCLUIDA" ? "foi disparada" : "foi aprovada"} — a mensagem sai pra essa pessoa na hora, separado do resto.
          </span>
        )}
      </div>

      {suggestion.data?.suggestion && (
        <div className="mb-4">
          <Callout>{suggestion.data.suggestion.explanation}</Callout>
        </div>
      )}

      <div className="card mb-5 p-5">
        <StatusBand counts={toBandCounts(counts)} unrecognizedCount={unrecognizedCount} />
        {pending > 0 && isReviewing && (
          <p className="mt-3 text-sm text-ink-muted">
            <span className="font-semibold text-ink">{pending}</span> de {appointments.length} linhas
            precisam de conferência antes do disparo.
          </p>
        )}
      </div>

      <div className="card mb-5 p-4">
        <p className="eyebrow mb-2">O que significa cada situação</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          {STATUS_EXPLANATION.filter((item) => (counts[item.status] ?? 0) > 0).map((item) => (
            <div key={item.status} className="flex items-start gap-2">
              <dt className="mt-0.5 shrink-0">
                <StatusPill status={item.status} />
              </dt>
              <dd className="text-xs text-ink-muted">{item.text}</dd>
            </div>
          ))}
        </dl>
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
        {(search || onlyIssues || statusFilter) && (
          <p className="mt-1 text-xs text-ink-faint">
            {filteredAppointments.length} de {appointments.length} pacientes
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={statusFilter === ""}
            className={`btn px-3 py-1.5 text-sm ${statusFilter === "" ? "btn-primary" : "btn-quiet"}`}
            onClick={() => setStatusFilter("")}
          >
            Todas ({appointments.length})
          </button>
          {STATUS_FILTER_OPTIONS.map((status) => {
            const count = appointments.filter((a) => a.status === status).length;
            if (count === 0) return null;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={statusFilter === status}
                className={`btn px-3 py-1.5 text-sm ${statusFilter === status ? "btn-primary" : "btn-quiet"}`}
                onClick={() => setStatusFilter(status)}
              >
                {STATUS_LABEL[status] ?? status} ({count})
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
                <Th align="right">Ações</Th>
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
                  <Td align="right">
                    {isReviewing ? (
                      isEditing ? (
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
                      )
                    ) : appointment.status === "CANCELADO" ? (
                      // Agenda cancelada pela equipe (módulo de
                      // Cancelamento) — reenviar confirmação não faz
                      // sentido aqui, o agendamento nem vale mais.
                      <span className="text-xs text-ink-faint" title="Agenda cancelada — não recebe confirmação">
                        —
                      </span>
                    ) : (
                      // Lista já disparada: a edição completa não vale mais
                      // (mensagem já saiu), mas o telefone pode estar
                      // errado mesmo assim — corrige e reenvia na hora,
                      // pra qualquer situação (não só falha/sem telefone).
                      <button
                        type="button"
                        className="btn btn-quiet px-2 py-1 text-xs"
                        onClick={() => openQuickFix(appointment)}
                      >
                        Corrigir telefone
                      </button>
                    )}
                  </Td>
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
            : confirmAction === "reprocess"
              ? "Tentar a leitura de novo?"
              : confirmAction === "dispatch"
                ? "Disparar as confirmações?"
                : "Concluir esta lista?"
        }
        description={
          confirmAction === "delete"
            ? `"${list.originalName}" e todos os agendamentos dela somem, sem volta. Como ainda não foi disparada, nenhuma mensagem de WhatsApp foi enviada — nada se perde do lado do paciente.`
            : confirmAction === "reprocess"
              ? "A leitura automática roda de novo do zero — qualquer correção feita manualmente nesta lista se perde."
              : confirmAction === "dispatch"
                ? `As mensagens são enviadas na hora, respeitando o limite diário da Meta — o que não couber fica na fila pro próximo envio. ${
                    pending > 0 ? `Atenção: ${pending} linhas ainda estão marcadas para conferência.` : ""
                  }`
                : "Marca a lista como encerrada. O relatório com o resultado de cada paciente continua disponível em \"Exportar CSV\"/\"Exportar PDF\" para enviar à secretaria manualmente."
        }
        confirmLabel={
          confirmAction === "delete"
            ? "Excluir"
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

      <FormModal
        open={approvePreviewOpen}
        title="Conferir mensagem antes de aprovar"
        description={
          approvePreview
            ? `Assim que aprovar, é essa a mensagem que sai pra cada um dos ${approvePreview.totalPatients} paciente(s) da lista (com os dados de cada um, claro) — abaixo, com os dados de "${approvePreview.patientName}", o primeiro da lista.`
            : "Montando a mensagem com os dados do primeiro paciente da lista…"
        }
        submitLabel="Confirmar e aprovar"
        busy={busy || approvePreviewLoading}
        error={approvePreviewError}
        onSubmit={confirmApprove}
        onCancel={() => setApprovePreviewOpen(false)}
      >
        {approvePreviewLoading && <Spinner />}
        {approvePreview && (
          <div className="rounded-lg bg-wa-bg p-4">
            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-wa-bubble-in px-3 py-2 text-sm text-ink shadow-sm">
              <p className="whitespace-pre-wrap">{approvePreview.text}</p>
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              Vai pro número {approvePreview.phone ? formatPhone(approvePreview.phone) : "— sem telefone cadastrado"}.
            </p>
          </div>
        )}
      </FormModal>

      <FormModal
        open={pendingResponseOpen}
        title="Quem ainda não respondeu"
        description="A mensagem chegou (ou pelo menos saiu), mas ninguém clicou Sim/Não nem escreveu nada ainda. Liga, explica que é só clicar no botão da mensagem, e já registra a resposta aqui se a pessoa confirmar por telefone."
        submitLabel="Fechar"
        hideCancel
        wide
        busy={false}
        error={contactError}
        onSubmit={() => setPendingResponseOpen(false)}
        onCancel={() => setPendingResponseOpen(false)}
      >
        {pendingResponseAppointments.length === 0 ? (
          <p className="text-sm text-ink-muted">Ninguém nessa situação — todo mundo já respondeu.</p>
        ) : (
          <div className="grid gap-2">
            {pendingResponseAppointments.map((a) => {
              const otherPhones = a.patient.phones.filter((p) => p !== a.selectedPhone);
              return (
                <div key={a.id} className="rounded-md border border-rule p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-ink">{a.patient.name}</p>
                      <p className="text-xs text-ink-faint">
                        {formatDateTime(a.scheduledAt)} · {a.procedure.name}
                      </p>
                    </div>
                    <StatusPill status={a.status} />
                  </div>
                  <p className="mt-2 text-sm">
                    <span className="text-ink-muted">Mensagem enviada pra </span>
                    <span className="tabular font-medium">{formatPhone(a.selectedPhone)}</span>
                  </p>
                  {otherPhones.length > 0 && (
                    <p className="text-xs text-ink-faint">
                      Outro(s) número(s) no cadastro: <span className="tabular">{otherPhones.map(formatPhone).join(", ")}</span>
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="btn btn-quiet px-2 py-1 text-xs"
                      style={{ color: "var(--mark-green)" }}
                      disabled={contactBusyId === a.id}
                      onClick={() => void quickContact(a.id, "CONFIRMADO")}
                    >
                      ✓ Confirmou por telefone
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet px-2 py-1 text-xs"
                      style={{ color: "var(--mark-red)" }}
                      disabled={contactBusyId === a.id}
                      onClick={() => void quickContact(a.id, "RECUSADO")}
                    >
                      ✕ Não vai comparecer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </FormModal>

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
            label={a.patient.name}
            hint={a.selectedPhone ? `Número que falhou: ${formatPhone(a.selectedPhone)}` : "Sem telefone no cadastro"}
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

      <FormModal
        open={quickFixTarget !== null}
        title="Corrigir telefone e reenviar"
        description={
          quickFixTarget
            ? `${quickFixTarget.patient.name} — número atual: ${
                quickFixTarget.selectedPhone ? formatPhone(quickFixTarget.selectedPhone) : "sem telefone"
              }. A confirmação sai de novo pro número certo, agora mesmo.`
            : ""
        }
        submitLabel="Corrigir e reenviar"
        busy={quickFixBusy}
        error={quickFixError}
        onSubmit={submitQuickFix}
        onCancel={() => setQuickFixTarget(null)}
      >
        <Field label="Telefone certo">
          <input
            className="field"
            type="tel"
            placeholder="(47) 99999-9999"
            value={quickFixPhone}
            onChange={(e) => setQuickFixPhone(e.target.value)}
          />
        </Field>
      </FormModal>

      <FormModal
        open={addOpen}
        title="Adicionar paciente manualmente"
        description="Pra quem a leitura automática não conseguiu reconhecer no PDF."
        submitLabel="Adicionar"
        busy={addBusy}
        error={addError}
        onSubmit={submitAdd}
        onCancel={() => setAddOpen(false)}
      >
        {addRawText && (
          <Callout tone="warn">
            <p className="text-xs font-semibold">Texto bruto lido do PDF pra esse registro:</p>
            <p className="mt-1 text-xs italic">"{addRawText}"</p>
            <p className="mt-1 text-xs text-ink-faint">
              Os campos abaixo já vieram pré-preenchidos com o que deu pra reconhecer — confira contra esse texto
              antes de adicionar, o palpite pode errar.
            </p>
          </Callout>
        )}
        <Field label="Nome do paciente">
          <input
            className="field"
            value={addForm.patientName}
            onChange={(e) => setAddForm({ ...addForm, patientName: e.target.value })}
            required
          />
        </Field>
        <Field label="CNS" hint="Opcional">
          <input
            className="field"
            value={addForm.cns}
            onChange={(e) => setAddForm({ ...addForm, cns: e.target.value })}
          />
        </Field>
        <Field label="Telefone">
          <input
            className="field"
            type="tel"
            placeholder="(47) 99999-9999"
            value={addForm.phone}
            onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
            required
          />
        </Field>
        <Field label="Data e hora">
          <input
            type="datetime-local"
            className="field"
            value={addForm.scheduledAt}
            onChange={(e) => setAddForm({ ...addForm, scheduledAt: e.target.value })}
            required
          />
        </Field>
        <Field label="Médico">
          <select
            className="field"
            value={addForm.doctorId}
            onChange={(e) => setAddForm({ ...addForm, doctorId: e.target.value })}
            required
          >
            <option value="">Selecione…</option>
            {doctorsData.data?.doctors
              .filter((d) => d.active || String(d.id) === addForm.doctorId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Procedimento">
          <select
            className="field"
            value={addForm.procedureId}
            onChange={(e) => setAddForm({ ...addForm, procedureId: e.target.value })}
            required
          >
            <option value="">Selecione…</option>
            {proceduresData.data?.procedures
              .filter((p) => p.active || String(p.id) === addForm.procedureId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={addForm.isFirstVisit}
            onChange={(e) => setAddForm({ ...addForm, isFirstVisit: e.target.checked })}
          />
          Primeira vez
        </label>
      </FormModal>
    </>
  );
}
