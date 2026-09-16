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
  sem segundos) e o maior trecho em maiúsculas perto dele (o nome). Linha
  sem os dois é ignorada — a pré-visualização (antes de gravar) mostra
  quantas linhas foram lidas e quantos pacientes da lista bateram, pra
  equipe perceber se alguma coisa ficou de fora.
*/

export interface ScheduleReferenceRow {
  time: string; // "HH:MM"
  name: string;
  rawLine: string;
}

const TIME_PATTERN = /\b(\d{2}):(\d{2})(?::\d{2})?\b/;
const NAME_CANDIDATE = /[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'.\s-]{4,}/g;

export function parseScheduleReference(text: string): ScheduleReferenceRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: ScheduleReferenceRow[] = [];
  for (const line of lines) {
    const timeMatch = line.match(TIME_PATTERN);
    if (!timeMatch || timeMatch.index === undefined) continue;
    const timeEnd = timeMatch.index + timeMatch[0].length;

    const nameCandidates = [...line.matchAll(NAME_CANDIDATE)]
      .map((match) => ({ text: match[0].trim(), index: match.index ?? 0 }))
      .filter((candidate) => candidate.text.split(/\s+/).length >= 2); // exige nome composto
    if (nameCandidates.length === 0) continue;

    // O nome do paciente costuma vir DEPOIS do horário na linha (outras
    // colunas em maiúsculas, como a descrição do exame/procedimento,
    // costumam vir antes) — prioriza o primeiro candidato depois do
    // horário; sem nenhum, cai pro último candidato da linha (mais
    // plausível que o primeiro, que tende a ser a descrição do exame).
    const afterTime = nameCandidates.find((candidate) => candidate.index >= timeEnd);
    const name = (afterTime ?? nameCandidates[nameCandidates.length - 1]!).text;
    rows.push({ time: `${timeMatch[1]}:${timeMatch[2]}`, name, rawLine: line });
  }
  return rows;
}
