import type { ExtractionResult } from "../extraction.schema.js";

/**
 * Os dois sistemas se identificam sozinhos no cabeçalho ou no rodapé —
 * dá pra escolher o parser certo antes de tentar ler qualquer linha.
 */
export function detectFormat(text: string): ExtractionResult["sourceFormat"] {
  if (/CELK\s+SA[ÚU]DE/i.test(text)) return "CELK";
  if (/SISREG/i.test(text) || /PROPRIEDADES DA AGENDA/i.test(text)) return "SISREG";
  return "OUTRO";
}
