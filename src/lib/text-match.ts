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
