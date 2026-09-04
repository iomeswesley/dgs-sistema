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
    SEM_DATA: { bg: "var(--mark-gray-soft)", fg: "var(--mark-gray)" },
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
export function Callout({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "danger";
}) {
  const style =
    tone === "danger"
      ? { background: "var(--mark-red-soft)", borderColor: "var(--mark-red)" }
      : tone === "warn"
        ? { background: "var(--mark-yellow-soft)", borderColor: "var(--mark-yellow)" }
        : { background: "var(--accent-soft)", borderColor: "var(--accent)" };
  return (
    <div className="rounded-lg border-l-4 px-4 py-3 text-sm text-ink" style={style}>
      {tone === "danger" && <span aria-hidden className="mr-1.5">⚠️</span>}
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
      {/* min-w-[720px] só a partir de md — abaixo disso ele forçava scroll
          lateral em toda tabela do site, mesmo nas que já couberiam sem
          problema com menos colunas visíveis no celular (achado pelo
          usuário em 2026-08-27, ver as colunas com `hidden md:table-cell`
          em Revisão/Hoje/CancelamentoDetalhe). Acima de md mantém a largura
          confortável de sempre — não muda nada no desktop. */}
      <table className={`w-full md:min-w-[720px] border-collapse text-sm ${colgroup ? "table-fixed" : ""}`}>
        {colgroup}
        <thead className="border-b border-rule bg-sheet-alt text-left">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  /** Ex.: "hidden md:table-cell" pra esconder a coluna no celular (ver `Td` — a mesma classe precisa ir nas duas, cabeçalho e célula). */
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint ${
        align === "right" ? "text-right" : ""
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  muted = false,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  muted?: boolean;
  /** Ex.: "hidden md:table-cell" — mesma classe do `Th` correspondente. */
  className?: string;
}) {
  return (
    <td
      className={`border-b border-rule px-3 py-2.5 ${align === "right" ? "text-right tabular" : ""} ${
        muted ? "text-ink-muted" : "text-ink"
      } ${className}`}
    >
      {children}
    </td>
  );
}
