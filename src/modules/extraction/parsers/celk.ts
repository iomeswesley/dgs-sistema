import type { ExtractedRow, ExtractionResult } from "../extraction.schema.js";
import { extractPhones, toIsoDateTime } from "./shared.js";

/*
  CELK exporta uma linha de texto por paciente, bem direta:

    NOME IDADE (DDD) TELEFONE [TELEFONE2 ...] DD/MM/AAAA - HH:MM CONVÊNIO [\tTELEFONE_EXTRA]

  O cabeçalho e o rodapé do relatório têm frases fixas que ajudam a achar
  médico, procedimento e unidade sem precisar warehouse de posição — e a
  identificar onde a tabela de pacientes começa e termina.
*/

const ROW_PATTERN =
  /^(?<before>.+?)\s+(?<date>\d{2}\/\d{2}\/\d{4})\s*-\s*(?<time>\d{2}:\d{2})\s+(?<convenio>\S.*?)(?:\t(?<extraPhones>.+))?$/;

export function parseCelk(text: string): ExtractionResult {
  const lines = text.split("\n").map((line) => line.trimEnd());
  const warnings: string[] = [];

  const municipalityMatch = text.match(/Prefeitura\s+Municipal\s+de\s+(.+)/i);
  const municipality = municipalityMatch?.[1]?.trim() ?? null;

  // A primeira ocorrência de "Unidade Executante" costuma ser "Múltipla
  // Seleção" (o filtro usado pra gerar o relatório) — a unidade de verdade
  // vem na ocorrência seguinte, sem esse texto.
  const unitMatches = [...text.matchAll(/Unidade\s+Executante:\s*([^\n]+)/gi)];
  const executingUnit =
    unitMatches.find((m) => !/M[uú]ltipla\s+Sele[cç][aã]o/i.test(m[1] ?? ""))?.[1]?.trim() ?? null;

  const procedureMatches = [...text.matchAll(/Tipo\s+Procedimento:\s*([^\n/]+)/gi)];
  const procedure =
    procedureMatches
      .map((m) => m[1]?.replace(/^\(\s*\d+\s*\)\s*/, "").trim())
      .find((value) => value && !/^Todos$/i.test(value)) ?? null;

  const doctorMatches = [...text.matchAll(/Profissional:\s*([^\n]+?)(?:\s+Conv[eê]nio:|\s*$)/gi)];
  const doctor =
    doctorMatches.map((m) => m[1]?.replace(/^\(\s*\d+\s*\)\s*/, "").trim()).find((value) => !!value) ?? null;

  const rows: ExtractedRow[] = [];
  for (const line of lines) {
    // Fora da tabela de pacientes (cabeçalho, rodapé, contagem final) — o
    // rodapé "Emitido por ... em DD/MM/AAAA - HH:MM" também tem data e hora,
    // então descarta explicitamente antes de tentar casar como paciente.
    if (!line.trim() || /Emitido\s+por/i.test(line)) continue;

    const match = line.match(ROW_PATTERN);
    if (!match?.groups) continue;

    const { before, date, time, convenio, extraPhones } = match.groups;
    if (!before || !date || !time) continue;
    const ageMatch = before.match(/^(.+?)\s+(\d{1,3})\s+(.*)$/);
    if (!ageMatch) continue; // linha de cabeçalho/rodapé sem idade — não é paciente

    const [, rawName, , phonesBlob] = ageMatch;
    if (!rawName || !phonesBlob) continue;
    const phones = [...extractPhones(phonesBlob), ...(extraPhones ? extractPhones(extraPhones) : [])];

    rows.push({
      name: rawName.trim(),
      cns: null,
      birthDate: null,
      phones,
      procedure: null,
      doctor: null,
      scheduledAt: toIsoDateTime(date, time),
      requestingUnit: null,
      isFirstVisit: null,
      // Determinístico: 1 quando todos os campos batem no formato esperado.
      confidence: 1,
      notes: convenio && !/^SUS$/i.test(convenio.trim()) ? `Convênio: ${convenio.trim()}` : null,
    });
  }

  if (rows.length === 0) {
    warnings.push("Nenhuma linha de paciente reconhecida no formato CELK — confira o arquivo manualmente.");
  }

  return {
    sourceFormat: "CELK",
    municipality,
    executingUnit,
    doctor,
    procedure,
    rows,
    warnings,
    // CELK é uma linha de texto por paciente, sem quebra de página no meio
    // — não tem casos de "registro não reconhecido" com dado pra aproveitar
    // como no SISREG, só a linha inteira ilegível ou nada.
    unrecognized: [],
  };
}
