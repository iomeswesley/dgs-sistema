import { findClosestMatch, levenshtein, normalizeForMatch } from "./text-match.js";

/*
  Leitura de uma LISTA DE REFERÊNCIA de horário — um PDF nativo de uma
  segunda fonte (ex.: sistema do laboratório/clínica que faz o exame, tipo
  CISAMVE) que traz o horário individual real de cada paciente, pra corrigir
  quando o SISREG só deu horário bucketizado (todo mundo da manhã em 07:00,
  todo mundo da tarde em 13:00 — caso real de 2026-09-16, Pomerode).

  Formato genérico, não um formato fixo de uma prefeitura/fonte específica
  (diferente de sisreg.ts/celk.ts/tabular.ts) — cada fonte de referência tem
  sua própria diagramação de colunas, então em vez de ancorar em campos na
  ordem certa, procura por PADRÃO em cada linha: um horário (HH:MM, com ou
  sem segundos) e os dois trechos em maiúsculas mais próximos dele — o que
  vem DEPOIS é o nome, o que vem ANTES (quando existe) é o procedimento. Um
  PDF cujo layout não trouxer nada reconhecível antes do horário (formato
  mais simples, só "HH:MM NOME") continua funcionando igual — `procedure`
  fica `null`, e o casamento (`matchScheduleReference()`) cai pra casar só
  por nome, exatamente como antes de o procedimento existir aqui.
*/

export interface ScheduleReferenceRow {
  time: string; // "HH:MM"
  name: string;
  /** Texto do procedimento, quando a linha trouxe algo reconhecível antes
   * do horário (ex.: CISAMVE) — `null` quando não dá pra distinguir (PDF
   * mais simples, sem essa coluna). */
  procedure: string | null;
  rawLine: string;
}

const TIME_PATTERN = /\b(\d{2}):(\d{2})(?::\d{2})?\b/;
// Inclui parênteses além de letra/espaço/pontuação (mas não dígito — isso
// deixaria o candidato "comer" o início da data/hora seguinte, ex.:
// "URINÁRIO 19/09/2026" virando "URINÁRIO 19") — o procedimento às vezes
// traz uma qualificação entre parênteses (ex.: "ULTRASSONOGRAFIA PÉLVICA
// (GINECOLÓGICA)", achado real no CISAMVE); sem isso esse trecho ficava
// cortado no "(" e a comparação de procedimento perdia metade do nome do
// exame.
const NAME_CANDIDATE = /[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'.\s()-]{4,}/g;

export function parseScheduleReference(text: string): ScheduleReferenceRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: ScheduleReferenceRow[] = [];
  for (const line of lines) {
    const timeMatch = line.match(TIME_PATTERN);
    if (!timeMatch || timeMatch.index === undefined) continue;
    const timeStart = timeMatch.index;
    const timeEnd = timeMatch.index + timeMatch[0].length;

    const candidates = [...line.matchAll(NAME_CANDIDATE)]
      .map((match) => ({ text: match[0].trim(), index: match.index ?? 0 }))
      .filter((candidate) => candidate.text.split(/\s+/).length >= 2); // exige nome/procedimento composto
    if (candidates.length === 0) continue;

    // O nome do paciente costuma vir DEPOIS do horário na linha (outras
    // colunas em maiúsculas, como a descrição do exame/procedimento,
    // costumam vir antes) — prioriza o primeiro candidato depois do
    // horário; sem nenhum, cai pro último candidato da linha (mais
    // plausível que o primeiro, que tende a ser a descrição do exame).
    const afterTime = candidates.filter((c) => c.index >= timeEnd);
    const beforeTime = candidates.filter((c) => c.index < timeStart);
    const name = (afterTime[0] ?? candidates[candidates.length - 1]!).text;
    // Procedimento: o candidato mais próximo do horário, do lado de ANTES
    // (formato "PROCEDIMENTO DATA HORA NOME", do CISAMVE) — só quando
    // existe e é diferente do que já virou nome (evita duplicar o mesmo
    // trecho nos dois campos num formato de coluna única).
    const procedureCandidate = beforeTime[beforeTime.length - 1];
    const procedure = procedureCandidate && procedureCandidate.text !== name ? procedureCandidate.text : null;

    rows.push({ time: `${timeMatch[1]}:${timeMatch[2]}`, name, procedure, rawLine: line });
  }
  return rows;
}

/** Só as três coisas que importam da comparação — remove o resto do jeito
 * que `normalizeForMatch()` não faz sozinho: prefixo "01 - " do código
 * SISREG (só existe no catálogo, não na fonte de referência), hífen
 * ("ULTRA-SONOGRAFIA" × "ULTRASSONOGRAFIA") e parênteses de qualificação. */
function normalizeProcedureForMatch(value: string): string {
  return normalizeForMatch(value)
    .replace(/^\d+\s*-\s*/, "")
    .replace(/[()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Acha, entre os nomes de procedimento candidatos, qual é o mesmo exame que
 * `target` descreve — mesmo padrão de `findClosestMatch()` (igual/contém
 * primeiro, depois distância de edição com margem, nunca adivinha em caso
 * ambíguo), mas com a normalização extra acima e um `maxDistance` maior:
 * nome de procedimento diverge bem mais entre fontes do que nome de pessoa
 * (não é só acento/caixa) — ex. real do CISAMVE: "ULTRASSONOGRAFIA MAMARIA
 * BILATERAL" × "01 - ULTRA-SONOGRAFIA DE MAMAS BILATERAL" do catálogo tem
 * distância 7 (palavra diferente pro mesmo exame: "mamária" × "de mamas",
 * fora prefixo/hífen). Ainda assim seguro: contra qualquer OUTRO
 * procedimento do catálogo a distância fica 13+ — a margem entre "é este
 * exame, com grafia diferente" e "é outro exame" é grande o bastante pra
 * `maxDistance = 8` nunca confundir os dois.
 */
export function findClosestProcedureName(target: string, candidateNames: string[], maxDistance = 8): string | null {
  const unique = [...new Set(candidateNames)];
  const normalizedTarget = normalizeProcedureForMatch(target);

  const exact = unique.filter((name) => {
    const normalized = normalizeProcedureForMatch(name);
    return normalized === normalizedTarget || normalized.includes(normalizedTarget) || normalizedTarget.includes(normalized);
  });
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const scored = unique
    .map((name) => ({ name, dist: levenshtein(normalizeProcedureForMatch(name), normalizedTarget) }))
    .sort((a, b) => a.dist - b.dist);
  const best = scored[0];
  const second = scored[1];
  if (best && best.dist <= maxDistance && (!second || second.dist > best.dist)) return best.name;
  return null;
}

export interface ScheduleReferenceCandidate {
  id: number;
  name: string;
  procedureName: string;
}

export interface ScheduleReferenceMatch {
  candidateId: number;
  referenceName: string;
  time: string;
}

export interface ScheduleReferenceMatchResult {
  matches: ScheduleReferenceMatch[];
  /** Linhas do PDF de referência sem candidato correspondente. */
  unmatchedReference: ScheduleReferenceRow[];
  /** Candidatos (agendamentos da lista) sem linha correspondente no PDF. */
  unmatchedCandidateIds: number[];
}

/**
 * Núcleo puro do casamento — sem banco, testável direto. `previewScheduleReference()`
 * (`lists.service.ts`) só busca os agendamentos da lista e chama isto, mesmo
 * padrão de `suggestions.ts`/`indicators.ts` (núcleo puro + service fino).
 *
 * Quando a linha trouxe procedimento reconhecível, filtra os candidatos por
 * procedimento (fuzzy, `findClosestProcedureName`) ANTES de casar por nome —
 * resolve paciente com 2 exames no mesmo dia (cada linha só compete com
 * candidatos do mesmo exame) e joga fora linha de exame que não pertence a
 * esta lista (nenhum candidato bate o procedimento → linha inteira fica sem
 * casar, não tenta casar por nome sozinho — seria arriscado demais, podia
 * casar por coincidência de nome com o paciente errado). Sem procedimento
 * na linha (PDF mais simples), cai pro comportamento de sempre: casa contra
 * a lista inteira só por nome.
 */
export function matchScheduleReference(
  rows: ScheduleReferenceRow[],
  candidates: ScheduleReferenceCandidate[]
): ScheduleReferenceMatchResult {
  const used = new Set<number>();
  const matches: ScheduleReferenceMatch[] = [];
  const unmatchedReference: ScheduleReferenceRow[] = [];

  for (const row of rows) {
    const available = candidates.filter((c) => !used.has(c.id));

    let pool = available;
    if (row.procedure) {
      const matchedProcedureName = findClosestProcedureName(
        row.procedure,
        available.map((c) => c.procedureName)
      );
      pool = matchedProcedureName ? available.filter((c) => c.procedureName === matchedProcedureName) : [];
    }

    const chosen = pool.length > 0 ? findClosestMatch(row.name, pool, (c) => c.name) : null;
    if (!chosen) {
      unmatchedReference.push(row);
      continue;
    }
    used.add(chosen.id);
    matches.push({ candidateId: chosen.id, referenceName: row.name, time: row.time });
  }

  const unmatchedCandidateIds = candidates.filter((c) => !used.has(c.id)).map((c) => c.id);
  return { matches, unmatchedReference, unmatchedCandidateIds };
}
