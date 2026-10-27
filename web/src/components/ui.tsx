import type { ReactNode } from "react";
import { STATUS_LABEL } from "../lib/format";

type StatusTone = "confirmado" | "aguardando" | "recusado" | "acao";

const STATUS_TONE: Record<string, StatusTone> = {
  CONFIRMADO: "confirmado",
  RECUSADO: "recusado",
  FALHA: "recusado",
  PENDENTE: "aguardando",
  ENVIADO: "aguardando",
  ENTREGUE: "aguardando",
  SEM_TELEFONE: "acao",
  SEM_DATA: "acao",
  SEM_RESPOSTA: "acao",
  CANCELADO: "acao",
};

/** Badge de status do paciente: pílula, texto --st-*-text sobre --st-*-bg. */
export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "acao";
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2.5 py-[3px] text-[13px] font-bold"
      style={{ background: `var(--st-${tone}-bg)`, color: `var(--st-${tone}-text)` }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <p className="py-10 text-center text-[14px] text-[var(--text-muted)]">{label}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-[10px] border px-3.5 py-3 text-[14px]"
      style={{ background: "var(--danger-bg)", borderColor: "var(--danger-border)", color: "var(--danger-text)" }}
    >
      {message}
    </p>
  );
}

/**
 * Aviso persistente. Regra do handoff: frase em negrito com o problema +
 * frase explicando a consequência ou o que fazer. "info" é estado de sistema
 * (azul); "warn"/"danger" usam os tokens próprios de aviso, nunca --st-*.
 */
export function Callout({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "danger";
}) {
  const style =
    tone === "danger"
      ? { background: "var(--danger-bg)", borderColor: "var(--danger-border)", color: "var(--danger-text)" }
      : tone === "warn"
        ? { background: "var(--warn-bg)", borderColor: "var(--warn-border)", color: "var(--warn-text)" }
        : { background: "var(--info-bg)", borderColor: "transparent", color: "var(--info-text)" };
  return (
    <div className="rounded-[10px] border px-3.5 py-3 text-[14px] leading-relaxed" style={style}>
      {children}
    </div>
  );
}

/** Toggle 38×22: ligado --action, desligado cinza-azulado (nunca verde). */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-[11px] transition-colors duration-[120ms] ease-out disabled:cursor-not-allowed disabled:opacity-60"
      style={{ background: checked ? "var(--action)" : "var(--border-strong)" }}
    >
      <span
        aria-hidden
        className="inline-block h-[18px] w-[18px] rounded-full bg-white"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
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
      {hint && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{hint}</p>}
    </label>
  );
}

/** KPI: número 46px Source Sans 3 600 com rótulo — indicadores e fechamento. */
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
      <p className="text-[14px] font-bold text-[var(--text-muted)]">{label}</p>
      <p className="num mt-1 text-[46px] font-semibold leading-none text-[var(--text)]">{value}</p>
      {detail && <p className="mt-2 text-[13px] text-[var(--text-muted)]">{detail}</p>}
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
   * `<col>` por coluna, com `width` fixo — sem isso a largura de cada coluna
   * reflete o conteúdo das linhas visíveis e as colunas "pulam" a cada filtro
   * (achado em 2026-08-26). Passar `colgroup` trava o layout.
   */
  colgroup?: ReactNode;
}) {
  return (
    <div className="card overflow-x-auto">
      {/* min-w só a partir de md — no celular forçava scroll lateral em toda
          tabela (achado em 2026-08-27). */}
      <table className={`w-full border-collapse text-[15px] md:min-w-[720px] ${colgroup ? "table-fixed" : ""}`}>
        {colgroup}
        <thead className="bg-[var(--surface-header)] text-left">{head}</thead>
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
  /** Ex.: "hidden md:table-cell" pra esconder a coluna no celular (mesma classe no `Td`). */
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2.5 text-[12px] font-bold text-[var(--text-muted)] ${
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
      className={`h-[var(--row-h)] border-t border-[var(--border-row)] px-4 py-2 ${
        align === "right" ? "num text-right" : ""
      } ${muted ? "text-[var(--text-muted)]" : "text-[var(--text)]"} ${className}`}
    >
      {children}
    </td>
  );
}
