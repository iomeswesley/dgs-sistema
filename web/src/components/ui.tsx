import type { ReactNode } from "react";
import { STATUS_LABEL } from "../lib/format";

/** Etiqueta de status do paciente, nas cores do marca-texto. */
export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, { bg: string; fg: string }> = {
    CONFIRMADO: { bg: "var(--mark-green-soft)", fg: "var(--mark-green)" },
    RECUSADO: { bg: "var(--mark-red-soft)", fg: "var(--mark-red)" },
    FALHA: { bg: "var(--mark-red-soft)", fg: "var(--mark-red)" },
    PENDENTE: { bg: "var(--mark-yellow-soft)", fg: "var(--mark-yellow)" },
    ENVIADO: { bg: "var(--mark-yellow-soft)", fg: "var(--mark-yellow)" },
    ENTREGUE: { bg: "var(--mark-yellow-soft)", fg: "var(--mark-yellow)" },
    SEM_TELEFONE: { bg: "var(--mark-gray-soft)", fg: "var(--mark-gray)" },
    SEM_RESPOSTA: { bg: "var(--mark-gray-soft)", fg: "var(--mark-gray)" },
    CANCELADO: { bg: "var(--mark-gray-soft)", fg: "var(--mark-gray)" },
  };
  const colors = tone[status] ?? tone.SEM_RESPOSTA!;

  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-ink-muted">{label}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md bg-mark-red-soft px-3 py-2 text-sm text-mark-red">
      {message}
    </p>
  );
}

/** Aviso persistente que precisa de atenção, não de cor de status. */
export function Callout({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const style =
    tone === "warn"
      ? { background: "var(--mark-yellow-soft)", borderColor: "var(--mark-yellow)" }
      : { background: "var(--accent-soft)", borderColor: "var(--accent)" };
  return (
    <div className="rounded-lg border-l-4 px-4 py-3 text-sm text-ink" style={style}>
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </label>
  );
}

/** Número grande com rótulo — usado nos indicadores e no fechamento. */
export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="card p-5">
      <p className="eyebrow">{label}</p>
      <p className="tabular mt-2 text-3xl font-bold tracking-tight text-ink">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-muted">{detail}</p>}
    </div>
  );
}

export function Table({
  head,
  children,
  colgroup,
}: {
  head: ReactNode;
  children: ReactNode;
  /**
   * `<col>` por coluna, com `width` fixo — sem isso o layout é `auto`, e a
   * largura de cada coluna reflete o conteúdo das linhas visíveis no
   * momento. Numa tabela que filtra (ex.: Cancelamento por situação da
   * mensagem), isso faz as colunas "pularem" de largura a cada filtro
   * clicado (achado em 2026-08-26). Passar `colgroup` trava o layout —
   * `table-layout: fixed` some do lugar assim que `<col>` existe.
   */
  colgroup?: ReactNode;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className={`w-full min-w-[720px] border-collapse text-sm ${colgroup ? "table-fixed" : ""}`}>
        {colgroup}
        <thead className="border-b border-rule bg-sheet-alt text-left">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  muted = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  muted?: boolean;
}) {
  return (
    <td
      className={`border-b border-rule px-3 py-2.5 ${align === "right" ? "text-right tabular" : ""} ${
        muted ? "text-ink-muted" : "text-ink"
      }`}
    >
      {children}
    </td>
  );
}
