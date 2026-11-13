import type { ExtractedRow, ExtractionResult, UnrecognizedGuess } from "../extraction.schema.js";

/*
  Formato "IPM" — relatório "Relação da Agenda para Contato" do Atende.Net
  (IPM Sistemas, módulo de Regulação "SRG"). Achado pela primeira vez em
  2026-11-13 (Camboriú, psiquiatria do Dr. Luiz Felipe, 16/11/2026):

    Unidade Executante: POLICLINICA MUNICIPAL
    Especialidade: Psiquiatra / Profissional: LUIZ FELIPE BESERRA BARROS
    PACIENTE Idade Telefone Telefone 2 Telefone 3 Celular Data e Hora Convênio Situação
    ALINE NEVES SILVA 42 47992104346 (47) 99210-4346 16/11/2026 08:00 SUS Agendado
    JAQUELINE PEREIRA 52 (47) 3363-8450, (47)       ← a coluna Celular quebra
    99927-1942, (47)                                  em várias linhas quando
    99955-5232                                        traz mais de um número
    16/11/2026 08:00 SUS Agendado                   ← e a data vem sozinha

  Um paciente = tudo desde a linha "NOME IDADE ..." até a linha que traz
  "DD/MM/AAAA HH:MM". Coluna vazia some do texto (não deixa marcador), então
  não dá pra saber de que coluna veio cada telefone — tanto faz,
  `normalizePhone()` decide fixo/celular pelo número.

  Telefone vem em qualquer formato, até dentro do mesmo arquivo: com ou sem
  parênteses, com ou sem hífen, colado ou com espaço, vários na mesma célula
  separados por vírgula, celular sem o nono dígito ("(47) 9666-2979",
  "4799157378"). Por isso a separação é por quantidade de dígitos, não por
  máscara — ver `splitPhones()`.

  Sem CNS e sem nascimento (só a idade, que não serve pra nada aqui). Médico
  e especialidade vêm por seção; a especialidade vira o procedimento.
*/

const DATE_TIME = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/;
// "ALINE NEVES SILVA 42 <telefones> 16/11/2026 08:00 SUS Agendado".
// Nome sem dígito nem parêntese (pra parar antes do primeiro telefone);
// idade opcional, 1 a 3 dígitos isolados.
const RECORD =
  /^([^\d()]*[^\d()\s])\s+(?:(\d{1,3})\s+)?(.*?)\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\b\s*(.*)$/;
const UNIT_LINE = /^Unidade\s+Executante:\s*(.+)$/i;
const SECTION_LINE = /^Especialidade:\s*(.+?)\s*\/\s*Profissional:\s*(.+)$/i;
const MUNICIPALITY_LINE =
  /^(?:FUNDO\s+MUNICIPAL\s+DE\s+SA[ÚU]DE|SECRETARIA\s+MUNICIPAL\s+DE\s+SA[ÚU]DE|PREFEITURA\s+MUNICIPAL)\s+D[EOA]\s+(.+)$/i;

// Cabeçalho/rodapé repetido em toda página. Uma quebra de página pode cair
// no meio de um paciente (coluna Celular quebrada) — tirar isso antes de
// juntar as linhas evita lixo no meio do registro.
const PAGE_NOISE = [
  MUNICIPALITY_LINE,
  /^Regula[cç][aã]o$/i,
  /^Rela[cç][aã]o da Agenda para Contato/i,
  /^Estabelecimento\s+P[úu]blico:/i,
  /^P[áa]g\s+\d+/i,
  /^IPM Sistemas/i,
  /^Atende\.Net/i,
  /^Identificador:/i,
  /^PACIENTE\s+Idade\s+Telefone/i,
  /^Quantidade\s+(?:de|total)/i,
  /^--\s*\d+\s+of\s+\d+\s*--$/,
];

/** Telefone de preenchimento do cadastro, tipo "(99)99999-9999" — não é de ninguém. */
function isPlaceholderPhone(digits: string): boolean {
  return /^(\d)\1+$/.test(digits.slice(2));
}

/**
 * Separa o trecho de telefones de um paciente em números individuais, seja
 * qual for a máscara. Regras, por pedaço (separado por espaço, vírgula,
 * ponto e vírgula ou barra):
 *  - pedaço que abre parêntese "(47)" sempre começa um número novo (é DDD);
 *  - pedaço que sozinho já tem 10+ dígitos é um número inteiro;
 *  - senão vai juntando pedaços ("47 9921 04346", "(47) 9 9210-4346") até
 *    chegar a 10 dígitos, sem passar de 11.
 * Devolve o texto original de cada número (é o que aparece como "telefone
 * inválido" na revisão quando não bate) — a normalização fica pro mapper.
 */
export function splitPhones(text: string): string[] {
  const pieces = text
    .split(/[\s,;/]+/)
    .map((piece) => piece.replace(/^\+55(?=\d|\()/, "").trim())
    .filter((piece) => piece && piece !== "+55" && /\d/.test(piece));

  const phones: string[] = [];
  let parts: string[] = [];
  let digits = "";

  const flush = () => {
    if (parts.length > 0) phones.push(parts.join(" "));
    parts = [];
    digits = "";
  };

  for (const piece of pieces) {
    const pieceDigits = piece.replace(/\D/g, "");
    if (piece.startsWith("(") || pieceDigits.length >= 10) {
      flush();
    } else if (digits.length >= 10 || digits.length + pieceDigits.length > 11) {
      flush();
    }
    parts.push(piece);
    digits += pieceDigits;
    if (digits.length >= 11) flush();
  }
  flush();

  const seen = new Set<string>();
  return phones.filter((phone) => {
    const phoneDigits = phone.replace(/\D/g, "");
    if (isPlaceholderPhone(phoneDigits) || seen.has(phoneDigits)) return false;
    seen.add(phoneDigits);
    return true;
  });
}

function unrecognizedFrom(rawText: string): UnrecognizedGuess {
  const name = rawText.match(/^([^\d()]+?)\s+\d/)?.[1]?.trim() ?? null;
  const area = rawText.replace(DATE_TIME, " ").replace(/^[^\d()]+?\s+\d{1,3}\s+/, " ");
  return { rawText, name, cns: null, birthDate: null, phones: splitPhones(area) };
}

interface Section {
  unit: string | null;
  specialty: string | null;
  doctor: string | null;
}

export function parseIpm(text: string): ExtractionResult {
  const rawLines = text.split("\n").map((line) => line.trim());
  const municipality =
    rawLines.map((line) => line.match(MUNICIPALITY_LINE)?.[1]?.trim()).find((value) => !!value) ?? null;

  const lines = rawLines.filter((line) => line && !PAGE_NOISE.some((noise) => noise.test(line)));

  const rows: ExtractedRow[] = [];
  const rowSections: Section[] = [];
  const warnings: string[] = [];
  const unrecognized: UnrecognizedGuess[] = [];
  const units: string[] = [];
  const sections: string[] = [];
  const dates = new Set<string>();

  const section: Section = { unit: null, specialty: null, doctor: null };
  let buffer: string[] = [];

  const reject = (rawText: string) => {
    warnings.push(`Registro não reconhecido: "${rawText}"`);
    unrecognized.push(unrecognizedFrom(rawText));
  };
  // Linhas acumuladas que nunca chegaram a uma data — não fecham paciente.
  const dropBuffer = () => {
    if (buffer.length > 0) reject(buffer.join(" "));
    buffer = [];
  };

  for (const line of lines) {
    const unit = line.match(UNIT_LINE);
    if (unit) {
      dropBuffer();
      section.unit = unit[1]!.trim();
      if (!units.includes(section.unit)) units.push(section.unit);
      continue;
    }
    const sectionMatch = line.match(SECTION_LINE);
    if (sectionMatch) {
      dropBuffer();
      section.specialty = sectionMatch[1]!.trim();
      section.doctor = sectionMatch[2]!.trim();
      const key = `${section.specialty} / ${section.doctor}`;
      if (!sections.includes(key)) sections.push(key);
      continue;
    }

    buffer.push(line);
    if (!DATE_TIME.test(line)) continue;

    const record = buffer.join(" ").replace(/\s+/g, " ").trim();
    buffer = [];

    const match = record.match(RECORD);
    if (!match) {
      reject(record);
      continue;
    }
    const [, name, , phonesText, day, month, year, hour, minute, tail] = match;
    const date = `${year}-${month}-${day}`;
    dates.add(date);

    // "SUS Agendado" — a última palavra é a situação. Qualquer coisa que não
    // seja "Agendado" (cancelado, faltou...) fica destacada pra equipe decidir.
    const situation = tail?.trim().split(" ").pop() ?? "";
    const scheduled = !situation || /^agendad[oa]$/i.test(situation);

    rows.push({
      name: name!.trim(),
      cns: null,
      birthDate: null,
      phones: splitPhones(phonesText ?? ""),
      procedure: null,
      doctor: null,
      scheduledAt: `${date}T${hour}:${minute}`,
      requestingUnit: null,
      isFirstVisit: null,
      confidence: scheduled ? 1 : 0.6,
      notes: scheduled ? null : `Situação no arquivo: "${situation}" — confira se o paciente deve ser avisado.`,
    });
    rowSections.push({ ...section });
  }
  dropBuffer();

  // Com mais de uma seção (especialidade/profissional), cada linha leva a
  // sua — mesmo cuidado do CELK com vários procedimentos no mesmo PDF.
  const multipleSections = sections.length > 1;
  if (multipleSections) {
    rows.forEach((row, index) => {
      row.procedure = rowSections[index]?.specialty ?? null;
      row.doctor = rowSections[index]?.doctor ?? null;
    });
    warnings.push(
      `Este arquivo traz ${sections.length} especialidades/profissionais (${sections.join("; ")}) — cada paciente ficou com o da sua seção; a agenda vinculada é de um só, confira.`
    );
  }

  if (rows.length === 0) {
    warnings.push("Nenhum paciente reconhecido no relatório do IPM (Atende.Net) — confira o arquivo manualmente.");
  }
  if (units.length > 1) {
    warnings.push(
      `Este arquivo traz ${units.length} unidades de atendimento (${units.join(", ")}) — a mensagem usa o endereço da unidade da agenda vinculada; confira.`
    );
  }
  if (dates.size > 1) {
    const sorted = [...dates].sort().map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
    warnings.push(
      `Este arquivo traz ${dates.size} dias de atendimento (${sorted.join(", ")}). Cada paciente fica com a própria data; a agenda vinculada é só a do primeiro dia.`
    );
  }

  const first = rowSections[0] ?? section;
  return {
    sourceFormat: "IPM",
    municipality,
    executingUnit: units[0] ?? null,
    doctor: multipleSections ? null : first.doctor,
    procedure: multipleSections ? null : first.specialty,
    rows,
    warnings,
    unrecognized,
  };
}
