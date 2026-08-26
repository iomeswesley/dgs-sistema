type Cell = string | number | null | undefined;

function escapeCell(value: Cell): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Aspas, ponto-e-vírgula e quebra de linha exigem o campo entre aspas.
  if (/["\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * CSV para abrir no Excel em português: separador ponto-e-vírgula e BOM
 * UTF-8. Sem o BOM o Excel lê os acentos errado, que é o primeiro problema
 * que aparece quando alguém abre o relatório.
 */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return buildCsv([headers, ...rows]);
}

/**
 * Igual `toCsv`, mas sem forçar uma única linha de cabeçalho fixa — cada
 * item de `rows` já é uma linha pronta (célula por célula). Usado pelos
 * relatórios "profissionais" que têm um bloco de metadados no topo e
 * seções por situação no meio, cada uma com seu próprio cabeçalho de
 * coluna (ver `list-report.ts`) — o Excel abre isso normalmente, cada
 * linha só usa as colunas que tem.
 */
export function buildCsv(rows: Cell[][]): string {
  const lines = rows.map((row) => row.map(escapeCell).join(";"));
  return `﻿${lines.join("\r\n")}`;
}
