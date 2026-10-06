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
  // O CELK pode trazer VÁRIOS procedimentos no mesmo PDF (uma seção por
  // procedimento: "Tipo Procedimento: X / Profissional: Y", seguida dos
  // pacientes dela e de uma linha de subtotal) — achado real em 2026-10-06
  // (Penha, Dr. Jesus: ultrassonografia obstétrica + de mama no mesmo
  // arquivo, e os 53 saíram como "obstétrico"). Rastreia a seção em vigor
  // pra cada paciente; o cabeçalho "Tipo Procedimento: Todos" (filtro) não
  // tem "/ Profissional:" e não conta como seção.
  const SECTION = /Tipo\s+Procedimento:\s*([^\n/]+?)\s*\/\s*Profissional:/i;
  let currentSection: string | null = null;
  const rowSections: (string | null)[] = [];
  for (const line of lines) {
    const section = line.match(SECTION);
    if (section?.[1]) {
      const name = section[1].replace(/^\(\s*\d+\s*\)\s*/, "").trim();
      if (name && !/^Todos$/i.test(name)) currentSection = name;
      continue;
    }
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

    rowSections.push(currentSection);
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

  // Mais de um procedimento no arquivo: cada paciente leva o da SUA seção e o
  // procedimento do cabeçalho fica em branco (não existe um só). Com um único
  // procedimento nada muda — continua valendo o do cabeçalho, como sempre.
  const distinctSections = [...new Set(rowSections.filter((name): name is string => !!name))];
  const multipleProcedures = distinctSections.length > 1;
  if (multipleProcedures) {
    rows.forEach((row, index) => {
      row.procedure = rowSections[index] ?? null;
    });
    warnings.push(
      `Este arquivo traz ${distinctSections.length} procedimentos (${distinctSections.join("; ")}) — cada paciente foi lido com o procedimento da sua seção. Confira se está certo.`
    );
  }

  return {
    sourceFormat: "CELK",
    municipality,
    executingUnit,
    doctor,
    procedure: multipleProcedures ? null : procedure,
    rows,
    warnings,
    // CELK é uma linha de texto por paciente, sem quebra de página no meio
    // — não tem casos de "registro não reconhecido" com dado pra aproveitar
    // como no SISREG, só a linha inteira ilegível ou nada.
    unrecognized: [],
  };
}
