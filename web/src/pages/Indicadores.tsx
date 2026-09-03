import { useState } from "react";
import { EmptyState, PageHeader } from "../components/AppShell";
import { MessagesPerDayChart } from "../components/MessagesPerDayChart";
import { ErrorNote, Field, Spinner, Stat, Table, Td, Th } from "../components/ui";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";
import { daysAgo, formatMoney, formatPercent, localDateString } from "../lib/format";

interface Totals {
  planned: number;
  contactable: number;
  confirmed: number;
  refused: number;
  noAnswer: number;
  unreachable: number;
  attended: number | null;
  paid: number | null;
  extras: number;
  confirmationRate: number | null;
  attendanceRate: number | null;
  utilizationRate: number | null;
  divergenceRate: number | null;
  doctorPayout: number | null;
  cityBilling: number | null;
  margin: number | null;
}

interface Breakdown extends Totals {
  key: string;
  label: string;
}

const GROUP_LABEL: Record<string, string> = {
  doctor: "Médico",
  municipality: "Município",
  procedure: "Procedimento",
  month: "Mês",
};

export function Indicadores() {
  const { user, clients } = useSession();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(localDateString());
  const [groupBy, setGroupBy] = useState("doctor");
  // Só super admin escolhe outro cliente — pedido do usuário em
  // 2026-09-02: ver os indicadores de qualquer cliente sem trocar o
  // cliente ativo da própria sessão. Começa no cliente ativo de quem
  // está vendo; `clients` (useSession) é só os que ELA tem acesso, então
  // usamos a lista de todos via /api/admin/clients pra super admin.
  const [viewingClientId, setViewingClientId] = useState<number | undefined>(user?.activeClientId);
  const adminClients = useApi<{ clients: { id: number; name: string }[] }>(
    user?.isSuperAdmin ? "/api/admin/clients" : null
  );

  const scopedClientId = user?.isSuperAdmin ? viewingClientId : undefined;
  const query = new URLSearchParams({
    from,
    to,
    groupBy,
    ...(scopedClientId ? { clientId: String(scopedClientId) } : {}),
  });
  const indicatorsPath = scopedClientId ? `/api/admin/indicators?${query}` : `/api/indicators?${query}`;
  const exportPath = scopedClientId ? `/api/admin/indicators/export?${query}` : `/api/indicators/export?${query}`;
  const data = useApi<{ totals: Totals; breakdown: Breakdown[] }>(indicatorsPath, [indicatorsPath]);

  const totals = data.data?.totals;

  return (
    <>
      <PageHeader
        eyebrow="Histórico"
        title="Indicadores"
        description="As mesmas taxas para qualquer recorte: por médico, município, procedimento ou mês."
        actions={
          <a className="btn btn-quiet" href={exportPath}>
            Exportar Excel
          </a>
        }
      />

      {user?.isSuperAdmin && (
        <div className="card mb-5 p-5">
          <Field label="Cliente" hint="Só você vê isso — é o admin global escolhendo qual cliente olhar.">
            <select
              className="field"
              value={viewingClientId ?? ""}
              onChange={(e) => setViewingClientId(Number(e.target.value))}
            >
              {(adminClients.data?.clients ?? clients).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <MessagesPerDayChart clientId={scopedClientId} />

      <div className="card mb-5 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="De">
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até">
            <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Agrupar por">
            <select className="field" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {Object.entries(GROUP_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {data.loading && <Spinner />}
      {data.error && <ErrorNote message={data.error} />}

      {totals && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Confirmação"
              value={formatPercent(totals.confirmationRate)}
              detail={`${totals.confirmed} de ${totals.contactable} contatáveis`}
            />
            <Stat
              label="Comparecimento"
              value={formatPercent(totals.attendanceRate)}
              detail={
                totals.attended === null
                  ? "aguardando lançamento dos atendidos"
                  : `${totals.attended} atendidos de ${totals.confirmed} confirmados`
              }
            />
            <Stat
              label="Aproveitamento"
              value={formatPercent(totals.utilizationRate)}
              detail={`sobre ${totals.planned} da lista`}
            />
            <Stat
              label="Divergência"
              value={formatPercent(totals.divergenceRate)}
              detail={
                totals.paid === null ? "aguardando conferência das guias" : `${totals.paid} guias`
              }
            />
          </div>

          {(totals.doctorPayout !== null || totals.cityBilling !== null) && (
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <Stat label="Repasse ao médico" value={formatMoney(totals.doctorPayout)} detail="guias × valor pago" />
              <Stat label="Faturamento" value={formatMoney(totals.cityBilling)} detail="guias × valor cobrado" />
              <Stat label="Margem" value={formatMoney(totals.margin)} detail="faturamento − repasse" />
            </div>
          )}
        </>
      )}

      {data.data?.breakdown.length === 0 && !data.loading && (
        <EmptyState
          title="Sem dados no período"
          description="Os indicadores preenchem depois do primeiro ciclo completo: lista disparada, respostas recebidas e fechamento lançado."
        />
      )}

      {(data.data?.breakdown.length ?? 0) > 0 && (
        <Table
          head={
            <tr>
              <Th>{GROUP_LABEL[groupBy]}</Th>
              <Th align="right">Planejados</Th>
              <Th align="right">Confirmados</Th>
              <Th align="right">Atendidos</Th>
              <Th align="right">Guias</Th>
              <Th align="right">Confirmação</Th>
              <Th align="right">Comparecimento</Th>
              <Th align="right">Margem 🚧</Th>
            </tr>
          }
        >
          {data.data?.breakdown.map((row) => (
            <tr key={row.key}>
              <Td>{row.label}</Td>
              <Td align="right" muted>
                {row.planned}
              </Td>
              <Td align="right">{row.confirmed}</Td>
              <Td align="right" muted>
                {row.attended ?? "—"}
              </Td>
              <Td align="right" muted>
                {row.paid ?? "—"}
              </Td>
              <Td align="right">{formatPercent(row.confirmationRate)}</Td>
              <Td align="right">{formatPercent(row.attendanceRate)}</Td>
              {/* Financeiro em desenvolvimento — nunca mostra valor, mesmo que
                  algum sobre de antes da decisão de escopo de 2026-08-09. */}
              <Td align="right" muted>
                —
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
