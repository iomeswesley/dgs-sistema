import { useState } from "react";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import { useApi } from "../lib/useApi";

/*
  Admin global (Fase 4 do PLANO-MULTICLIENTE.md) — só quem tem
  `isSuperAdmin`. Visão de todos os clientes (não só o ativo da sessão,
  ver requireSuperAdmin/runAsSuperAdmin no backend), criar cliente novo,
  gerenciar quem tem acesso a cada um.
*/

// Espelha BillingStatus (src/modules/billing/billing.ts) — mode: null = sem limite.
interface BillingStatus {
  mode: "JANELA" | "CREDITOS" | null;
  blocked: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetsAt: string | null;
}

interface BillingConfig {
  billingMode: "JANELA" | "CREDITOS" | null;
  messageLimit: number | null;
  periodStartDate: string | null;
  periodLengthDays: number | null;
  creditsBalance: number | null;
}

interface AdminClient {
  id: number;
  name: string;
  active: boolean;
  notes: string | null;
  createdAt: string;
  _count: { municipalities: number; patients: number; appointments: number; users: number };
  billing: BillingStatus;
  billingConfig: BillingConfig | null;
  billingError: string | null;
}

interface ClientUser {
  id: number;
  name: string;
  email: string;
  active: boolean;
  isSuperAdmin: boolean;
}

export function Admin() {
  const clients = useApi<{ clients: AdminClient[] }>("/api/admin/clients");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<AdminClient | null>(null);
  const [managingAccess, setManagingAccess] = useState<AdminClient | null>(null);
  const [managingBilling, setManagingBilling] = useState<AdminClient | null>(null);

  async function createClient() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/clients", { name: form.name, notes: form.notes || undefined });
      setCreating(false);
      setForm({ name: "", notes: "" });
      clients.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!toggling) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/clients/${toggling.id}`, { active: !toggling.active });
      setToggling(null);
      clients.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao alterar.");
      setToggling(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Clientes"
        description="Visão de todos os clientes da plataforma — quem só a DGS (administrador global) enxerga."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            + Novo cliente
          </button>
        }
      />

      {error && <ErrorNote message={error} />}

      {clients.loading && <Spinner />}
      {clients.error && <ErrorNote message={clients.error} />}

      {clients.data && (
        <Table
          head={
            <tr>
              <Th>Cliente</Th>
              <Th>Municípios</Th>
              <Th>Pacientes</Th>
              <Th>Agendamentos</Th>
              <Th>Equipe</Th>
              <Th>Situação</Th>
              <Th>Cobrança</Th>
              <Th>Ações</Th>
            </tr>
          }
        >
          {clients.data.clients.map((c) => (
            <tr key={c.id} className="border-b border-rule last:border-0">
              <Td>
                <div className="font-medium text-ink">{c.name}</div>
                {c.notes && <div className="text-xs text-ink-muted">{c.notes}</div>}
              </Td>
              <Td>{c._count.municipalities}</Td>
              <Td>{c._count.patients}</Td>
              <Td>{c._count.appointments}</Td>
              <Td>{c._count.users}</Td>
              <Td>
                <span className={c.active ? "text-ink" : "text-ink-muted"}>
                  {c.active ? "Ativo" : "Inativo"}
                </span>
              </Td>
              <Td>
                <BillingSummary billing={c.billing} error={c.billingError} />
              </Td>
              <Td>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="text-xs text-accent underline underline-offset-2"
                    onClick={() => setManagingAccess(c)}
                  >
                    Gerenciar acesso
                  </button>
                  <button
                    type="button"
                    className="text-xs text-accent underline underline-offset-2"
                    onClick={() => setManagingBilling(c)}
                  >
                    Cobrança
                  </button>
                  <button
                    type="button"
                    className="text-xs text-ink-muted underline underline-offset-2"
                    onClick={() => setToggling(c)}
                  >
                    {c.active ? "Desativar" : "Reativar"}
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {clients.data && clients.data.clients.length === 0 && (
        <Callout tone="warn">Nenhum cliente cadastrado ainda.</Callout>
      )}

      <FormModal
        open={creating}
        title="Novo cliente"
        description='Um cliente pode conter uma ou várias municipalidades (ex.: "DGS" atende Camboriú, Blumenau, Pomerode e Indaial). Não é o mesmo que cadastrar um município — isso é feito depois, dentro do cliente, em Configurações.'
        busy={busy}
        error={error}
        onSubmit={createClient}
        onCancel={() => {
          setCreating(false);
          setError(null);
        }}
      >
        <div className="space-y-4">
          <Field label="Nome do cliente">
            <input
              className="field"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder='Ex.: "DGS" ou o nome da prefeitura, se contratar direto'
            />
          </Field>
          <Field label="Observações (opcional)">
            <textarea
              className="field"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </Field>
        </div>
      </FormModal>

      <ConfirmModal
        open={!!toggling}
        title={toggling?.active ? "Desativar cliente?" : "Reativar cliente?"}
        description={
          toggling?.active
            ? `Ninguém mais vai conseguir logar no cliente "${toggling?.name}" enquanto estiver inativo. O dado continua todo lá.`
            : `"${toggling?.name}" volta a operar normalmente.`
        }
        confirmLabel={toggling?.active ? "Desativar" : "Reativar"}
        onConfirm={toggleActive}
        onCancel={() => setToggling(null)}
      />

      {managingAccess && (
        <ClientAccessModal client={managingAccess} onClose={() => setManagingAccess(null)} />
      )}

      {managingBilling && (
        <ClientBillingModal
          client={managingBilling}
          onClose={() => setManagingBilling(null)}
          onSaved={() => {
            setManagingBilling(null);
            clients.reload();
          }}
        />
      )}

      <ContactLeads />
    </div>
  );
}

interface ContactLead {
  id: number;
  createdAt: string;
  name: string;
  organization: string;
  role: string | null;
  phone: string;
  email: string;
  message: string | null;
  notifiedAt: string | null;
}

function ContactLeads() {
  const leads = useApi<{ leads: ContactLead[] }>("/api/admin/leads");

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-ink">Contatos do site</h2>
      <p className="mb-3 text-sm text-ink-muted">Quem preencheu o formulário da página pública (os mais recentes primeiro).</p>
      {leads.loading && <Spinner />}
      {leads.error && <ErrorNote message={leads.error} />}
      {leads.data && leads.data.leads.length === 0 && <Callout>Nenhum contato recebido ainda.</Callout>}
      {leads.data && leads.data.leads.length > 0 && (
        <Table
          head={
            <tr>
              <Th>Recebido em</Th>
              <Th>Nome</Th>
              <Th>Secretaria / município</Th>
              <Th>Contato</Th>
              <Th>Mensagem</Th>
            </tr>
          }
        >
          {leads.data.leads.map((lead) => (
            <tr key={lead.id} className="border-b border-rule align-top last:border-0">
              <Td>
                <div className="whitespace-nowrap">{formatDateTime(lead.createdAt)}</div>
                <div className="text-xs text-ink-muted">{lead.notifiedAt ? "Avisado no WhatsApp" : "Sem aviso no WhatsApp"}</div>
              </Td>
              <Td>
                <div className="font-medium text-ink">{lead.name}</div>
                {lead.role && <div className="text-xs text-ink-muted">{lead.role}</div>}
              </Td>
              <Td>{lead.organization}</Td>
              <Td>
                <div className="whitespace-nowrap">{lead.phone}</div>
                <a className="text-xs text-accent underline underline-offset-2" href={`mailto:${lead.email}`}>
                  {lead.email}
                </a>
              </Td>
              <Td>
                <div className="max-w-sm whitespace-pre-wrap text-sm">{lead.message || "—"}</div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

/** Resumo curto do status de cobrança pra tabela de clientes. */
function BillingSummary({ billing, error }: { billing: BillingStatus; error: string | null }) {
  if (error) return <span className="text-xs text-rose-600" title={error}>⚠️ Erro ao calcular</span>;
  if (!billing.mode) return <span className="text-xs text-ink-muted">Sem limite</span>;

  const label =
    billing.mode === "JANELA"
      ? `${billing.used}${billing.limit != null ? `/${billing.limit}` : ""}${
          billing.resetsAt ? ` · até ${formatDate(billing.resetsAt)}` : ""
        }`
      : `${billing.remaining ?? "—"} créditos`;

  return (
    <div className="text-xs">
      <div className={billing.blocked ? "font-medium text-rose-600" : "text-ink"}>{label}</div>
      {billing.blocked && <div className="text-rose-600">Bloqueado</div>}
    </div>
  );
}

type BillingFormMode = "SEM_LIMITE" | "JANELA" | "CREDITOS";

function ClientBillingModal({
  client,
  onClose,
  onSaved,
}: {
  client: AdminClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const config = client.billingConfig;
  const [mode, setMode] = useState<BillingFormMode>(
    config?.billingMode === "JANELA" ? "JANELA" : config?.billingMode === "CREDITOS" ? "CREDITOS" : "SEM_LIMITE"
  );
  const [messageLimit, setMessageLimit] = useState(String(config?.messageLimit ?? ""));
  const [periodStartDate, setPeriodStartDate] = useState(
    config?.periodStartDate ? config.periodStartDate.slice(0, 10) : ""
  );
  const [periodLengthDays, setPeriodLengthDays] = useState(String(config?.periodLengthDays ?? "30"));
  const [creditsBalance, setCreditsBalance] = useState(String(config?.creditsBalance ?? ""));
  const [addAmount, setAddAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "SEM_LIMITE") {
        await api.patch(`/api/admin/clients/${client.id}/billing`, { billingMode: null });
      } else if (mode === "JANELA") {
        await api.patch(`/api/admin/clients/${client.id}/billing`, {
          billingMode: "JANELA",
          messageLimit: Number(messageLimit),
          periodStartDate,
          periodLengthDays: Number(periodLengthDays),
        });
      } else {
        await api.patch(`/api/admin/clients/${client.id}/billing`, {
          billingMode: "CREDITOS",
          creditsBalance: Number(creditsBalance),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function addCredits() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/clients/${client.id}/billing/credits`, { amount: Number(addAmount) });
      setAddAmount("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao adicionar créditos.");
    } finally {
      setBusy(false);
    }
  }

  const isCreditosJaConfigurado = config?.billingMode === "CREDITOS";

  return (
    <FormModal
      open
      title={`Cobrança — ${client.name}`}
      description="Limite comercial de mensagens de WhatsApp. Sem nenhum modo, o cliente manda sem limite (estado de hoje pra todo mundo)."
      busy={busy}
      error={error}
      onSubmit={save}
      onCancel={onClose}
    >
      <div className="space-y-4">
        {client.billing.mode && (
          <Callout tone={client.billing.blocked ? "danger" : "info"}>
            {client.billing.mode === "JANELA"
              ? `${client.billing.used}${client.billing.limit != null ? ` de ${client.billing.limit}` : ""} mensagens usadas nesta janela${
                  client.billing.resetsAt ? ` · próxima em ${formatDate(client.billing.resetsAt)}` : ""
                }`
              : `${client.billing.remaining ?? "—"} créditos restantes de ${client.billing.limit ?? "—"} concedidos`}
            {client.billing.blocked && " — envio pausado até liberar mais."}
          </Callout>
        )}

        <Field label="Modo de cobrança">
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value as BillingFormMode)}>
            <option value="SEM_LIMITE">Sem limite</option>
            <option value="JANELA">Janela (teto de mensagens por período)</option>
            <option value="CREDITOS">Créditos (saldo que só acaba quando adiciona mais)</option>
          </select>
        </Field>

        {mode === "JANELA" && (
          <>
            <Field label="Limite de mensagens na janela">
              <input
                className="field"
                type="number"
                min={1}
                value={messageLimit}
                onChange={(e) => setMessageLimit(e.target.value)}
              />
            </Field>
            <Field label="Data de início">
              <input
                className="field"
                type="date"
                value={periodStartDate}
                onChange={(e) => setPeriodStartDate(e.target.value)}
              />
            </Field>
            <Field label="Duração da janela (dias)">
              <input
                className="field"
                type="number"
                min={1}
                value={periodLengthDays}
                onChange={(e) => setPeriodLengthDays(e.target.value)}
                placeholder="7 pra teste, 30 pra mensalidade..."
              />
            </Field>
          </>
        )}

        {mode === "CREDITOS" && (
          <>
            <Field label={isCreditosJaConfigurado ? "Saldo inicial (só ao trocar de modo)" : "Saldo inicial de créditos"}>
              <input
                className="field"
                type="number"
                min={0}
                value={creditsBalance}
                onChange={(e) => setCreditsBalance(e.target.value)}
              />
            </Field>

            {isCreditosJaConfigurado && (
              <div className="rounded-lg border border-rule p-3">
                <p className="mb-2 text-xs text-ink-muted">
                  Adicionar créditos preserva o saldo restante atual — não sobrescreve.
                </p>
                <div className="flex items-end gap-2">
                  <Field label="Adicionar créditos">
                    <input
                      className="field"
                      type="number"
                      min={1}
                      value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                    />
                  </Field>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={busy || !addAmount}
                    onClick={addCredits}
                  >
                    Adicionar
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </FormModal>
  );
}

function ClientAccessModal({ client, onClose }: { client: AdminClient; onClose: () => void }) {
  const users = useApi<{ users: ClientUser[] }>(`/api/admin/clients/${client.id}/users`);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ClientUser | null>(null);

  async function grant() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/clients/${client.id}/users`, { email });
      setEmail("");
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conceder acesso.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/admin/clients/${client.id}/users/${revoking.id}`);
      setRevoking(null);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao revogar.");
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormModal
      open
      wide
      title={`Acesso — ${client.name}`}
      description="Conceder acesso exige que a pessoa já tenha um login criado em Equipe — isso aqui não cria usuário novo, só dá acesso a este cliente pra quem já existe."
      submitLabel="Conceder acesso"
      busy={busy}
      error={error}
      onSubmit={grant}
      onCancel={onClose}
    >
      <div className="space-y-4">
        <Field label="E-mail de quem já tem login">
          <input
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@dgs.local"
          />
        </Field>

        {users.loading && <Spinner />}
        {users.error && <ErrorNote message={users.error} />}
        {users.data && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-rule">
            {users.data.users.length === 0 && (
              <p className="p-3 text-xs text-ink-muted">Ninguém tem acesso a este cliente ainda.</p>
            )}
            {users.data.users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between border-b border-rule px-3 py-2 text-sm last:border-0"
              >
                <div>
                  <div className="font-medium text-ink">
                    {u.name} {u.isSuperAdmin && <span className="text-xs text-accent">(admin)</span>}
                  </div>
                  <div className="text-xs text-ink-muted">{u.email}</div>
                </div>
                <button
                  type="button"
                  className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                  onClick={() => setRevoking(u)}
                >
                  Revogar
                </button>
              </div>
            ))}
          </div>
        )}

        <ConfirmModal
          open={!!revoking}
          title="Revogar acesso?"
          description={`"${revoking?.name}" deixa de ver o cliente "${client.name}" — se for o único acesso da pessoa, o backend recusa e pede pra desativar em Equipe em vez disso.`}
          confirmLabel="Revogar"
          onConfirm={revoke}
          onCancel={() => setRevoking(null)}
        />
      </div>
    </FormModal>
  );
}
