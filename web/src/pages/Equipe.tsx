import { useState } from "react";
import { PageHeader } from "../components/AppShell";
import { ConfirmModal } from "../components/ConfirmModal";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime } from "../lib/format";
import { useSession } from "../lib/session";

interface TeamUser {
  id: number;
  name: string;
  email: string;
  active: boolean;
  lastLoginAt: string | null;
}

interface AuditLog {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: { id: number; name: string } | null;
}

const ACTION_LABEL: Record<string, string> = {
  login: "entrou no sistema",
  create: "cadastrou",
  update: "alterou",
  delete: "excluiu",
  approve: "aprovou a lista",
  dispatch: "disparou a lista",
  edit_review: "corrigiu na revisão",
  remove_review: "removeu da lista",
  manual_contact: "registrou contato",
  refusal_reason: "classificou a recusa",
  opt_out: "marcou opt-out",
  closing_attended: "lançou atendidos",
  closing_paid: "lançou guias",
  create_user: "criou usuário",
  reset_password: "redefiniu senha",
  activate_user: "reativou usuário",
  deactivate_user: "desativou usuário",
  change_own_password: "trocou a própria senha",
};

const ENTITY_LABEL: Record<string, string> = {
  User: "usuário",
  List: "lista",
  Appointment: "agendamento",
  DailyClosing: "fechamento",
  Municipality: "município",
  HealthUnit: "unidade",
  Doctor: "médico",
  Procedure: "procedimento",
  DoctorProcedure: "valores do médico",
  Agenda: "agenda",
  Patient: "paciente",
};

export function Equipe() {
  const { user: me } = useSession();
  const team = useApi<{ users: TeamUser[] }>("/api/team");
  const audit = useApi<{ logs: AuditLog[] }>("/api/audit?limit=200");

  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ name: "", email: "" });
  const [generatedPassword, setGeneratedPassword] = useState<{ email: string; password: string } | null>(
    null
  );
  const [resetting, setResetting] = useState<TeamUser | null>(null);
  const [toggling, setToggling] = useState<TeamUser | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ user: TeamUser; password: string }>("/api/team", form);
      setGeneratedPassword({ email: result.user.email, password: result.password });
      setInviting(false);
      setForm({ name: "", email: "" });
      team.reload();
      audit.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!resetting) return;
    setBusy(true);
    try {
      const result = await api.post<{ password: string }>(`/api/team/${resetting.id}/reset-password`);
      setGeneratedPassword({ email: resetting.email, password: result.password });
      setResetting(null);
      audit.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao redefinir.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!toggling) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/team/${toggling.id}/active`, { active: !toggling.active });
      setToggling(null);
      team.reload();
      audit.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao alterar.");
      setToggling(null);
    } finally {
      setBusy(false);
    }
  }

  async function changeOwnPassword() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/team/me/password", passwordForm);
      setChangingPassword(false);
      setPasswordForm({ currentPassword: "", newPassword: "" });
      audit.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao trocar a senha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Acesso"
        title="Equipe e auditoria"
        description="Todo mundo aqui pode tudo. Por isso cada lançamento fica registrado com o nome de quem fez."
        actions={
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => setChangingPassword(true)}>
              Trocar minha senha
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
              Novo acesso
            </button>
          </div>
        }
      />

      {generatedPassword && (
        <div className="mb-5">
          <Callout tone="warn">
            <p className="font-semibold">Senha de {generatedPassword.email}</p>
            <p className="mt-1 font-mono text-lg tracking-wide">{generatedPassword.password}</p>
            <p className="mt-1 text-xs">
              Anote e repasse pessoalmente — ela não aparece de novo. Peça para a pessoa trocar no
              primeiro acesso.
            </p>
            <button
              type="button"
              className="btn btn-quiet mt-3"
              onClick={() => setGeneratedPassword(null)}
            >
              Já anotei
            </button>
          </Callout>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <h2 className="eyebrow mb-2">Quem tem acesso</h2>
      {team.loading && <Spinner />}
      {team.data && (
        <div className="mb-8">
          <Table
            head={
              <tr>
                <Th>Pessoa</Th>
                <Th>Último acesso</Th>
                <Th>Situação</Th>
                <Th align="right">Ações</Th>
              </tr>
            }
          >
            {team.data.users.map((user) => (
              <tr key={user.id} style={user.active ? undefined : { opacity: 0.55 }}>
                <Td>
                  <span className="font-medium">{user.name}</span>
                  {user.id === me?.id && <span className="ml-2 text-xs text-ink-faint">você</span>}
                  <p className="text-xs text-ink-faint">{user.email}</p>
                </Td>
                <Td muted>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "nunca entrou"}</Td>
                <Td muted>{user.active ? "Ativo" : "Desativado"}</Td>
                <Td align="right">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      className="btn btn-quiet px-2 py-1 text-xs"
                      onClick={() => setResetting(user)}
                    >
                      Redefinir senha
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet px-2 py-1 text-xs"
                      onClick={() => setToggling(user)}
                    >
                      {user.active ? "Desativar" : "Reativar"}
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <h2 className="eyebrow mb-2">Últimos lançamentos</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Toda alteração manual — principalmente atendidos e guias, que viram pagamento.
      </p>
      {audit.loading && <Spinner />}
      {audit.data?.logs.length === 0 && (
        <p className="card p-8 text-center text-sm text-ink-muted">Nada registrado ainda.</p>
      )}
      {(audit.data?.logs.length ?? 0) > 0 && (
        <Table
          head={
            <tr>
              <Th>Quando</Th>
              <Th>Quem</Th>
              <Th>O quê</Th>
              <Th>Mudança</Th>
            </tr>
          }
        >
          {audit.data?.logs.map((log) => (
            <tr key={log.id}>
              <Td muted>{formatDateTime(log.createdAt)}</Td>
              <Td>{log.user?.name ?? "sistema"}</Td>
              <Td muted>
                {ACTION_LABEL[log.action] ?? log.action}
                {log.entity && ` · ${ENTITY_LABEL[log.entity] ?? log.entity}`}
                {log.entityId !== null && ` #${log.entityId}`}
              </Td>
              <Td muted>
                {log.field && <span className="text-ink">{log.field}: </span>}
                {log.oldValue !== null && <span className="line-through">{log.oldValue}</span>}
                {log.oldValue !== null && log.newValue !== null && " → "}
                {log.newValue !== null && <span className="text-ink">{log.newValue}</span>}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={inviting}
        title="Novo acesso"
        description="A senha é gerada agora e mostrada uma única vez."
        busy={busy}
        error={error}
        onSubmit={invite}
        onCancel={() => setInviting(false)}
      >
        <Field label="Nome">
          <input
            className="field"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field label="E-mail">
          <input
            type="email"
            className="field"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </Field>
      </FormModal>

      <FormModal
        open={changingPassword}
        title="Trocar minha senha"
        busy={busy}
        error={error}
        onSubmit={changeOwnPassword}
        onCancel={() => setChangingPassword(false)}
      >
        <Field label="Senha atual">
          <input
            type="password"
            className="field"
            autoComplete="current-password"
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
            required
          />
        </Field>
        <Field label="Nova senha" hint="Pelo menos 8 caracteres.">
          <input
            type="password"
            className="field"
            autoComplete="new-password"
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            required
          />
        </Field>
      </FormModal>

      <ConfirmModal
        open={resetting !== null}
        title={`Redefinir a senha de ${resetting?.name ?? ""}?`}
        description="Uma senha nova é gerada e a atual deixa de funcionar na hora."
        confirmLabel="Redefinir"
        busy={busy}
        onConfirm={resetPassword}
        onCancel={() => setResetting(null)}
      />

      <ConfirmModal
        open={toggling !== null}
        title={toggling?.active ? `Desativar ${toggling.name}?` : `Reativar ${toggling?.name ?? ""}?`}
        description={
          toggling?.active
            ? "A pessoa perde o acesso imediatamente. O histórico do que ela lançou continua registrado."
            : "A pessoa volta a entrar com a senha que já tinha."
        }
        confirmLabel={toggling?.active ? "Desativar" : "Reativar"}
        danger={toggling?.active}
        busy={busy}
        onConfirm={toggleActive}
        onCancel={() => setToggling(null)}
      />
    </>
  );
}
