import { useState } from "react";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";

/*
  Admin global (Fase 4 do PLANO-MULTICLIENTE.md) — só quem tem
  `isSuperAdmin`. Visão de todos os clientes (não só o ativo da sessão,
  ver requireSuperAdmin/runAsSuperAdmin no backend), criar cliente novo,
  gerenciar quem tem acesso a cada um.
*/

interface AdminClient {
  id: number;
  name: string;
  active: boolean;
  notes: string | null;
  createdAt: string;
  _count: { municipalities: number; patients: number; appointments: number; users: number };
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
    </div>
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
