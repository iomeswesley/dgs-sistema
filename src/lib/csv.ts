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
  const lines = [headers.map(escapeCell).join(";")];
  for (const row of rows) lines.push(row.map(escapeCell).join(";"));
  return `﻿${lines.join("\r\n")}`;
}
