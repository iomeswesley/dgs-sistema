import type { ExtractionResult } from "../extraction.schema.js";

/**
 * Os dois sistemas se identificam sozinhos no cabeçalho ou no rodapé —
 * dá pra escolher o parser certo antes de tentar ler qualquer linha.
 */
export function detectFormat(text: string): ExtractionResult["sourceFormat"] {
  if (/CELK\s+SA[ÚU]DE/i.test(text)) return "CELK";
  // Rodapé do relatório "Agendamento de Consulta" do IDS Saúde (Ascurra, 2026-10-16).
  if (/IDS\s+Sa[úu]de/i.test(text) && /TDmAgeCon/i.test(text)) return "IDS";
  // Checa ANTES do teste genérico de SISREG abaixo: esse formato tem
  // "SISREG" só como rótulo da primeira coluna (o código de solicitação),
  // não é o relatório fragmentado de verdade — o cabeçalho da tabela é o
  // sinal confiável (achado em 2026-09-16, lista de Botuverá).
  if (/Nome\s+Data\s+nasc\.\s+Telefone\s+Procedimento\s+Data\s+Hor[aá]rio/i.test(text)) return "TABULAR";
  // Relatório "Agendamento de Exames" do CISAMVE (exame, data, horário, nome — sem telefone).
  if (/Agendamento de Exames/i.test(text) && /Descri[cç][aã]o do Exame\s+Data\s+Hor[aá]rio\s+Nome do Usu[aá]rio/i.test(text)) {
    return "CISAMVE";
  }
  if (/SISREG/i.test(text) || /PROPRIEDADES DA AGENDA/i.test(text)) return "SISREG";
  return "OUTRO";
}
