import { useState } from "react";
import { EmptyState, PageHeader } from "../components/AppShell";
import { FormModal } from "../components/FormModal";
import { Callout, ErrorNote, Field, Spinner, Table, Td, Th } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { daysAgo, formatCalendarDate, localDateString } from "../lib/format";

interface ClosingRow {
  doctorId: number;
  doctorName: string;
  municipalityId: number;
  municipalityName: string;
  procedureId: number | null;
  procedureName: string | null;
  date: string;
  planned: number;
  confirmed: number;
  refused: number;
  noAnswer: number;
  unreachable: number;
  attendedReported: number | null;
  attendedReportedBy: string | null;
  paidCount: number | null;
  paidCountBy: string | null;
  extrasCount: number;
  notes: string | null;
  alerts: string[];
}

export function Fechamento() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(localDateString());
  const data = useApi<{ rows: ClosingRow[] }>(`/api/closings?from=${from}&to=${to}`, [from, to]);

  const [editing, setEditing] = useState<ClosingRow | null>(null);
  const [form, setForm] = useState({ attended: "", paid: "", extras: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor(row: ClosingRow) {
    setEditing(row);
    setError(null);
    setForm({
      attended: row.attendedReported?.toString() ?? "",
      paid: row.paidCount?.toString() ?? "",
      extras: row.extrasCount.toString(),
      notes: row.notes ?? "",
    });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/closings", {
        doctorId: editing.doctorId,
        municipalityId: editing.municipalityId,
        procedureId: editing.procedureId,
        date: editing.date,
        attendedReported: form.attended === "" ? null : Number(form.attended),
        paidCount: form.paid === "" ? null : Number(form.paid),
        extrasCount: form.extras === "" ? 0 : Number(form.extras),
        notes: form.notes || null,
      });
      setEditing(null);
      data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar o fechamento.");
    } finally {
      setBusy(false);
    }
  }

  const rowsWithAlerts = data.data?.rows.filter((row) => row.alerts.length > 0) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Conciliação"
        title="Fechamento"
        description="Os três números de um mesmo dia, lado a lado. Confirmados sai do sistema; atendidos e guias são lançados aqui."
      />

      <div className="card mb-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="De">
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até">
            <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </div>

      {rowsWithAlerts.length > 0 && (
        <div className="mb-5">
          <Callout tone="warn">
            <p className="font-semibold">
              {rowsWithAlerts.length} {rowsWithAlerts.length === 1 ? "linha não fecha" : "linhas não fecham"}:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {rowsWithAlerts.slice(0, 5).map((row) => (
                <li key={`${row.doctorId}-${row.date}-${row.procedureId}`}>
                  {formatCalendarDate(row.date)} · {row.doctorName}: {row.alerts[0]}
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      )}

      {data.loading && <Spinner />}
      {data.error && <ErrorNote message={data.error} />}

      {data.data?.rows.length === 0 && !data.loading && (
        <EmptyState
          title="Nada para fechar no período"
          description="A grade aparece quando houver atendimento com data no intervalo escolhido. Ajuste as datas acima."
        />
      )}

      {(data.data?.rows.length ?? 0) > 0 && (
        <Table
          head={
            <tr>
              <Th>Dia / médico</Th>
              <Th align="right">Planejados</Th>
              <Th align="right">Confirmados</Th>
              <Th align="right">Atendidos</Th>
              <Th align="right">Encaixes</Th>
              <Th align="right">Guias</Th>
              <Th align="right">Lançar</Th>
            </tr>
          }
        >
          {data.data?.rows.map((row) => (
            <tr
              key={`${row.doctorId}-${row.municipalityId}-${row.procedureId}-${row.date}`}
              style={row.alerts.length > 0 ? { background: "var(--mark-yellow-soft)" } : undefined}
            >
              <Td>
                <span className="font-medium">{formatCalendarDate(row.date)}</span> · {row.doctorName}
                <p className="text-xs text-ink-faint">
                  {row.municipalityName}
                  {row.procedureName && ` · ${row.procedureName}`}
                </p>
                {row.alerts.map((alert) => (
                  <p key={alert} className="mt-0.5 text-xs text-mark-red">
                    {alert}
                  </p>
                ))}
              </Td>
              <Td align="right" muted>
                {row.planned}
              </Td>
              <Td align="right">{row.confirmed}</Td>
              <Td align="right">
                {row.attendedReported ?? "—"}
                {row.attendedReportedBy && (
                  <p className="text-xs font-normal text-ink-faint">{row.attendedReportedBy}</p>
                )}
              </Td>
              <Td align="right" muted>
                {row.extrasCount || "—"}
              </Td>
              <Td align="right">
                {row.paidCount ?? "—"}
                {row.paidCountBy && (
                  <p className="text-xs font-normal text-ink-faint">{row.paidCountBy}</p>
                )}
              </Td>
              <Td align="right">
                <button
                  type="button"
                  className="btn btn-quiet px-2 py-1 text-xs"
                  onClick={() => openEditor(row)}
                >
                  Lançar
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <FormModal
        open={editing !== null}
        title={editing ? `${formatCalendarDate(editing.date)} · ${editing.doctorName}` : ""}
        description={
          editing
            ? `O sistema apurou ${editing.confirmed} confirmados de ${editing.planned} da lista. Lance abaixo o que o médico informou e o que as guias comprovam.`
            : undefined
        }
        busy={busy}
        error={error}
        onSubmit={save}
        onCancel={() => setEditing(null)}
      >
        <Field label="Check 2 — atendidos" hint="O número que o médico informou no fim do dia.">
          <input
            type="number"
            min={0}
            className="field"
            value={form.attended}
            onChange={(e) => setForm({ ...form, attended: e.target.value })}
          />
        </Field>

        <Field
          label="Encaixes"
          hint="Atendidos que não estavam na lista. Sem isso a conta nunca fecha."
        >
          <input
            type="number"
            min={0}
            className="field"
            value={form.extras}
            onChange={(e) => setForm({ ...form, extras: e.target.value })}
          />
        </Field>

        <Field label="Check 3 — guias" hint="O número que o financeiro conferiu. É o que vira pagamento.">
          <input
            type="number"
            min={0}
            className="field"
            value={form.paid}
            onChange={(e) => setForm({ ...form, paid: e.target.value })}
          />
        </Field>

        <Field label="Observação">
          <textarea
            className="field"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </FormModal>
    </>
  );
}
