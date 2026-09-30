import ExcelJS from "exceljs";
import type { ExtractedRow, ExtractionResult } from "../extraction.schema.js";
import {
  HEADER_FIELDS,
  MAX_PATIENT_ROWS,
  PATIENT_COLUMNS,
  SHEET_HEADER,
  SHEET_PATIENTS,
  normalizeHeader,
  type HeaderKey,
  type PatientKey,
} from "../excel-layout.js";

/*
  Leitor do modelo Excel de importação (ver `excel-layout.ts`).

  Determinístico, sem IA: acha as colunas pelo texto do cabeçalho (não pela
  posição), então a pessoa pode reordenar/ocultar colunas sem quebrar. Cada
  célula com formato errado vira um aviso NA LINHA (confiança baixa + nota,
  que a Revisão já destaca) em vez de derrubar a lista inteira — e nada é
  adivinhado: valor que não bate no formato esperado fica vazio.

  Tipos de célula que o Excel devolve pro mesmo "campo": data pode vir como
  Date (célula formatada como data), texto ("25/09/2026") ou número serial;
  hora como Date, fração do dia (0.3125 = 07:30) ou texto; telefone e CNS
  como número ou texto. Tudo isso é tratado abaixo.
*/

const HEADER_SCAN_ROWS = 15;

/** Arquivo que não abre como .xlsx — quem chama converte em erro 400 (não importa o errorHandler aqui: mantém o parser testável sem env). */
export class ExcelReadError extends Error {}

type Raw = ExcelJS.CellValue;

/** Texto "como aparece" na célula (resolve rich text, fórmula, link). */
function cellText(value: Raw): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "SIM" : "NÃO";
  if (value instanceof Date) return "";
  if (typeof value === "object") {
    const obj = value as unknown as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((part) => part.text ?? "").join("").trim();
    }
    if ("result" in obj) return cellText(obj.result as Raw);
    if (typeof obj.text === "string") return obj.text.trim();
  }
  return "";
}

/** Resolve o valor "de verdade" (fórmula -> resultado). */
function resolveValue(value: Raw): Raw {
  if (value && typeof value === "object" && !(value instanceof Date) && "result" in (value as object)) {
    return (value as { result?: Raw }).result ?? null;
  }
  return value;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last;
}

const pad = (n: number) => String(n).padStart(2, "0");

type Parsed<T> = { value: T | null; invalid: string | null };

/** Data -> "AAAA-MM-DD". `invalid` traz o texto original quando não bate. */
function parseDate(raw: Raw): Parsed<string> {
  const value = resolveValue(raw);
  if (value === null || value === undefined || value === "") return { value: null, invalid: null };

  if (value instanceof Date) {
    // exceljs devolve a data da célula com componentes em UTC.
    const [y, m, d] = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
    return isValidCalendarDate(y, m, d)
      ? { value: `${y}-${pad(m)}-${pad(d)}`, invalid: null }
      : { value: null, invalid: value.toISOString() };
  }

  if (typeof value === "number") {
    // Serial do Excel (dias desde 1899-12-30). Só aceita faixa plausível.
    if (value >= 1 && value < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
      return { value: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`, invalid: null };
    }
    return { value: null, invalid: String(value) };
  }

  const text = cellText(value);
  if (!text) return { value: null, invalid: null };

  const br = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+\d{1,2}:\d{2}.*)?$/);
  if (br) {
    const [d, m, y] = [Number(br[1]), Number(br[2]), Number(br[3])];
    if (isValidCalendarDate(y, m, d)) return { value: `${y}-${pad(m)}-${pad(d)}`, invalid: null };
    return { value: null, invalid: text };
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (isValidCalendarDate(y, m, d)) return { value: `${y}-${pad(m)}-${pad(d)}`, invalid: null };
  }
  return { value: null, invalid: text };
}

/** Hora -> "HH:MM". */
function parseTime(raw: Raw): Parsed<string> {
  const value = resolveValue(raw);
  if (value === null || value === undefined || value === "") return { value: null, invalid: null };

  const fromMinutes = (minutes: number): Parsed<string> => {
    const total = Math.round(minutes) % 1440;
    return { value: `${pad(Math.floor(total / 60))}:${pad(total % 60)}`, invalid: null };
  };

  if (value instanceof Date) {
    return fromMinutes(value.getUTCHours() * 60 + value.getUTCMinutes() + (value.getUTCSeconds() >= 30 ? 1 : 0));
  }
  if (typeof value === "number") {
    if (value < 0 || !Number.isFinite(value)) return { value: null, invalid: String(value) };
    return fromMinutes((value - Math.floor(value)) * 1440);
  }

  const text = cellText(value);
  if (!text) return { value: null, invalid: null };
  const match = text.match(/^(\d{1,2})\s*[:hH.]\s*(\d{2})(?:\s*:\s*\d{2})?\s*(?:h|hs)?$/);
  if (match) {
    const [h, m] = [Number(match[1]), Number(match[2])];
    if (h <= 23 && m <= 59) return { value: `${pad(h)}:${pad(m)}`, invalid: null };
  }
  return { value: null, invalid: text };
}

/** Só dígitos — telefone/CNS digitados como número perdem formatação. */
function digitsOf(raw: Raw): string {
  const value = resolveValue(raw);
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value)) : "";
  return cellText(value).replace(/\D/g, "");
}

function parseVisitType(raw: Raw): Parsed<boolean> {
  const text = cellText(resolveValue(raw));
  if (!text) return { value: null, invalid: null };
  const norm = normalizeHeader(text);
  if (/^(1 vez|1a vez|primeira vez|primeira|1)$/.test(norm)) return { value: true, invalid: null };
  if (/^(retorno|reconsulta)$/.test(norm)) return { value: false, invalid: null };
  return { value: null, invalid: text };
}

function findSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const wanted = normalizeHeader(name);
  return workbook.worksheets.find((sheet) => normalizeHeader(sheet.name) === wanted);
}

function readHeaderSheet(sheet: ExcelJS.Worksheet | undefined): Partial<Record<HeaderKey, string>> {
  const out: Partial<Record<HeaderKey, string>> = {};
  if (!sheet) return out;
  const byLabel = new Map(HEADER_FIELDS.map((field) => [normalizeHeader(field.label), field.key]));
  sheet.eachRow((row) => {
    const key = byLabel.get(normalizeHeader(cellText(row.getCell(1).value)));
    if (!key) return;
    const cell = row.getCell(2).value;
    if (key === "date") {
      const parsed = parseDate(cell);
      if (parsed.value) out.date = parsed.value;
      else if (parsed.invalid) out.date = `INVALID:${parsed.invalid}`;
      return;
    }
    const text = cellText(cell);
    if (!text) return;
    // Município: a pessoa costuma escrever "TIMBÓ-SC" / "Timbó/SC" / "Timbó (SC)"
    // mesmo com o modelo pedindo só o nome — a comparação com o cadastro é
    // exata, então tira a sigla de UF no fim (achado real, 2026-09-30).
    out[key] = key === "municipality" ? text.replace(/\s*[-/(,]\s*[A-Za-z]{2}\s*\)?\s*$/, "").trim() || text : text;
  });
  return out;
}

export async function parseExcel(file: Buffer): Promise<ExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs tipa Buffer de um jeito próprio; o conteúdo é o mesmo.
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw new ExcelReadError(
      "Não consegui abrir o arquivo Excel. Salve como .xlsx (Pasta de Trabalho do Excel) e envie de novo."
    );
  }

  const warnings: string[] = [];
  const header = readHeaderSheet(findSheet(workbook, SHEET_HEADER));
  const headerDate = header.date && !header.date.startsWith("INVALID:") ? header.date : null;
  if (header.date?.startsWith("INVALID:")) {
    warnings.push(
      `Aba "${SHEET_HEADER}": "Data do atendimento padrão" (${header.date.slice(8)}) não está no formato DD/MM/AAAA e foi ignorada.`
    );
  }

  const sheet =
    findSheet(workbook, SHEET_PATIENTS) ??
    workbook.worksheets.find((s) => ![normalizeHeader("Instruções"), normalizeHeader(SHEET_HEADER)].includes(normalizeHeader(s.name)));
  const empty = (extraWarning: string): ExtractionResult => ({
    sourceFormat: "EXCEL",
    municipality: header.municipality ?? null,
    executingUnit: header.executingUnit ?? null,
    doctor: header.doctor ?? null,
    procedure: header.procedure ?? null,
    rows: [],
    warnings: [...warnings, extraWarning],
    unrecognized: [],
  });
  if (!sheet) return empty(`Não achei a aba "${SHEET_PATIENTS}". Use o modelo oficial (botão "Baixar modelo Excel").`);

  // Acha a linha de cabeçalho (o modelo tem na 1ª, mas tolera linhas de
  // título acima) e mapeia cada coluna pelo texto.
  const aliasToKey = new Map<string, PatientKey>();
  for (const column of PATIENT_COLUMNS) {
    aliasToKey.set(normalizeHeader(column.label), column.key);
    for (const alias of column.aliases) if (!aliasToKey.has(alias)) aliasToKey.set(alias, column.key);
  }

  let headerRowNumber = 0;
  const columnOf = new Map<PatientKey, number>();
  const ignored: string[] = [];
  for (let r = 1; r <= Math.min(sheet.rowCount, HEADER_SCAN_ROWS) && !headerRowNumber; r++) {
    const found = new Map<PatientKey, number>();
    const unknown: string[] = [];
    sheet.getRow(r).eachCell((cell, col) => {
      const text = cellText(cell.value);
      if (!text) return;
      const key = aliasToKey.get(normalizeHeader(text));
      if (key && !found.has(key)) found.set(key, col);
      else unknown.push(text);
    });
    if (found.has("name")) {
      headerRowNumber = r;
      found.forEach((col, key) => columnOf.set(key, col));
      ignored.push(...unknown);
    }
  }
  if (!headerRowNumber) {
    return empty(
      `Não achei a coluna "Nome completo" na aba "${sheet.name}". O arquivo não parece estar no modelo — baixe o modelo em "Baixar modelo Excel" e copie os dados da secretaria para ele.`
    );
  }
  if (ignored.length > 0) {
    warnings.push(
      `Colunas ignoradas (não fazem parte do modelo): ${ignored.slice(0, 8).join(", ")}${ignored.length > 8 ? "…" : ""}.`
    );
  }
  if (!columnOf.has("time")) warnings.push('A coluna "Horário" não existe na planilha — nenhum paciente terá horário.');

  const rows: ExtractedRow[] = [];
  const lastRow = Math.min(sheet.rowCount, headerRowNumber + MAX_PATIENT_ROWS);
  if (sheet.rowCount > headerRowNumber + MAX_PATIENT_ROWS) {
    warnings.push(
      `A planilha tem mais de ${MAX_PATIENT_ROWS} linhas; só as primeiras ${MAX_PATIENT_ROWS} foram lidas. Divida em mais de um arquivo.`
    );
  }

  for (let r = headerRowNumber + 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const get = (key: PatientKey): Raw => {
      const col = columnOf.get(key);
      return col ? row.getCell(col).value : null;
    };
    const filled = (key: PatientKey) => {
      const v = resolveValue(get(key));
      return v instanceof Date || cellText(v) !== "";
    };

    const name = cellText(resolveValue(get("name"))).replace(/\s+/g, " ");
    const anyOther = (["cns", "phone1", "phone2", "procedure", "doctor", "date", "time"] as PatientKey[]).some(filled);
    if (!name && !anyOther) continue; // linha em branco
    const notes: string[] = [];
    if (!name) notes.push("Sem nome do paciente");

    // CNS: 15 dígitos exatos, senão descarta com aviso.
    let cns: string | null = null;
    const cnsDigits = digitsOf(get("cns"));
    if (cnsDigits) {
      if (cnsDigits.length === 15) cns = cnsDigits;
      else notes.push(`CNS "${cnsDigits}" não tem 15 dígitos e foi ignorado`);
    }

    const birth = parseDate(get("birthDate"));
    if (birth.invalid) notes.push(`Data de nascimento "${birth.invalid}" não está em DD/MM/AAAA e foi ignorada`);

    // Telefones: cada célula é um número (aceita vários separados por / ou ;
    // como gentileza — o modelo pede um por célula).
    const phones: string[] = [];
    for (const key of ["phone1", "phone2"] as PatientKey[]) {
      const raw = resolveValue(get(key));
      const pieces = typeof raw === "number" ? [String(Math.round(raw))] : cellText(raw).split(/[/;]/);
      for (const piece of pieces) {
        const digits = piece.replace(/\D/g, "");
        if (digits) phones.push(digits);
      }
    }

    const date = parseDate(get("date"));
    if (date.invalid) notes.push(`Data do atendimento "${date.invalid}" não está em DD/MM/AAAA`);
    const time = parseTime(get("time"));
    if (time.invalid) notes.push(`Horário "${time.invalid}" não está em HH:MM`);

    // Data+hora podem vir juntas numa célula de data com horário.
    let effectiveTime = time.value;
    const rawDate = resolveValue(get("date"));
    if (!effectiveTime && rawDate instanceof Date && (rawDate.getUTCHours() || rawDate.getUTCMinutes())) {
      effectiveTime = parseTime(rawDate).value;
    }

    const day = date.value ?? headerDate;
    let scheduledAt: string | null = null;
    if (day && effectiveTime) scheduledAt = `${day}T${effectiveTime}`;
    else if (day && !time.invalid) notes.push("Horário não informado");

    const visit = parseVisitType(get("visitType"));
    if (visit.invalid) notes.push(`Tipo de vaga "${visit.invalid}" não reconhecido (use 1ª vez ou Retorno)`);

    rows.push({
      name,
      cns,
      birthDate: birth.value,
      phones,
      procedure: cellText(resolveValue(get("procedure"))) || null,
      doctor: cellText(resolveValue(get("doctor"))) || null,
      scheduledAt,
      requestingUnit: cellText(resolveValue(get("requestingUnit"))) || null,
      isFirstVisit: visit.value,
      confidence: notes.length > 0 ? 0.6 : 1,
      notes: notes.length > 0 ? `${notes.join("; ")} (linha ${r} da planilha)` : null,
    });
  }

  if (rows.length === 0) warnings.push("Nenhum paciente encontrado na aba de pacientes — a planilha está vazia?");
  if (!header.municipality) {
    warnings.push(`Aba "${SHEET_HEADER}": "Município" está em branco — escolha o município ao enviar a lista.`);
  }

  return {
    sourceFormat: "EXCEL",
    municipality: header.municipality ?? null,
    executingUnit: header.executingUnit ?? null,
    doctor: header.doctor ?? null,
    procedure: header.procedure ?? null,
    rows,
    warnings,
    unrecognized: [],
  };
}
