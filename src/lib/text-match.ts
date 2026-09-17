// Comparação de nomes livres (município, unidade, médico...) vindos de
// fontes diferentes — o que o PDF traz e o que está cadastrado. Ignora
// acento, caixa e espaço nas pontas; considera igual quando um contém o
// outro (ex.: "POLICLINICA MUNICIPAL" dentro de "POLICLINICA MUNICIPAL
// PREFEITO ALWIN KLOTZ").

const DIACRITICS = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .trim();
}

/**
 * Só considera igual — sem conter/estar contido. Município usa isso: não
 * existe abreviação válida de nome de cidade, e por conter seria fácil
 * confundir cidades vizinhas de nome parecido ("Camboriú" bate dentro de
 * "Balneário Camboriú", que é outro município).
 */
export function exactNameMatch(a: string, b: string): boolean {
  return normalizeForMatch(a) === normalizeForMatch(b);
}

/**
 * Igual, ou um nome contido no outro — pra unidade/médico/procedimento,
 * onde é normal o mesmo lugar aparecer com nome encurtado ("SAIS" vs "SAIS
 * SERVICO DE ATENDIMENTO INTEGRAL A SAUDE", "UBS SAO JOAO" vs "SAO JOAO").
 * Não usar pra município — ver `exactNameMatch`.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Acha o único candidato cujo nome bate com `value`, ou `null` quando não
 * há nenhum ou há mais de um (ambíguo demais pra escolher sozinho).
 */
export function findUniqueMatch<T>(
  value: string | null,
  candidates: T[],
  nameOf: (item: T) => string,
  options?: { exact?: boolean }
): T | null {
  if (!value) return null;
  const matchFn = options?.exact ? exactNameMatch : namesMatch;
  const matches = candidates.filter((item) => matchFn(value, nameOf(item)));
  return matches.length === 1 ? matches[0]! : null;
}

/** Distância de edição (Levenshtein) entre duas strings — exportada porque
 * `schedule-reference.ts` reaproveita pra casar procedimento entre fontes
 * com grafia bem diferente (ex.: "ULTRASSONOGRAFIA..." do CISAMVE vs
 * "ULTRA-SONOGRAFIA..." do catálogo), onde nem `namesMatch` resolve. */
export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * Como `findUniqueMatch`, mas com um segundo passo de tolerância a erro de
 * digitação/grafia quando `namesMatch` não resolve sozinho (nem igual, nem
 * um contendo o outro) — usado pra casar nome entre DUAS fontes diferentes
 * de dado (ex.: lista do SISREG × lista de referência de outro sistema),
 * onde pequenas diferenças de grafia são comuns ("NATALI" vs "NATALIE",
 * "ATANKEVCZ" vs "ATANKEVICZ") e não podem travar o casamento inteiro.
 * Só aceita o mais próximo por distância de edição quando a distância é
 * pequena (`maxDistance`, padrão 3) E claramente menor que a do segundo
 * colocado — caso contrário fica `null` (ambíguo demais, não adivinha).
 * Validado manualmente em 2026-09-16 (correção de horário da lista 84 via
 * CISAMVE) antes de virar helper reaproveitável.
 */
export function findClosestMatch<T>(
  value: string,
  candidates: T[],
  nameOf: (item: T) => string,
  maxDistance = 3
): T | null {
  const exact = candidates.filter((item) => namesMatch(value, nameOf(item)));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const normalizedValue = normalizeForMatch(value);
  const scored = candidates
    .map((item) => ({ item, dist: levenshtein(normalizeForMatch(nameOf(item)), normalizedValue) }))
    .sort((a, b) => a.dist - b.dist);
  const best = scored[0];
  const second = scored[1];
  if (best && best.dist <= maxDistance && (!second || second.dist > best.dist)) return best.item;
  return null;
}
