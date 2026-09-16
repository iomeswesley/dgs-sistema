import type { ExtractionResult } from "../extraction.schema.js";

/**
 * Os dois sistemas se identificam sozinhos no cabeçalho ou no rodapé —
 * dá pra escolher o parser certo antes de tentar ler qualquer linha.
 */
export function detectFormat(text: string): ExtractionResult["sourceFormat"] {
  if (/CELK\s+SA[ÚU]DE/i.test(text)) return "CELK";
  // Checa ANTES do teste genérico de SISREG abaixo: esse formato tem
  // "SISREG" só como rótulo da primeira coluna (o código de solicitação),
  // não é o relatório fragmentado de verdade — o cabeçalho da tabela é o
  // sinal confiável (achado em 2026-09-16, lista de Botuverá).
  if (/Nome\s+Data\s+nasc\.\s+Telefone\s+Procedimento\s+Data\s+Hor[aá]rio/i.test(text)) return "TABULAR";
  if (/SISREG/i.test(text) || /PROPRIEDADES DA AGENDA/i.test(text)) return "SISREG";
  return "OUTRO";
}
