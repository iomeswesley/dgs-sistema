/*
  Peças usadas pelos dois parsers (CELK e SISREG). Nada aqui chama rede nem
  banco — só transformação de texto, pra ficar testável de ponta a ponta
  como o resto do módulo de extração.
*/

/** "25/06/2026" + "07:20" -> "2026-06-25T07:20". Null se algo não bater. */
export function toIsoDateTime(dateBr: string, time: string): string | null {
  const dateMatch = dateBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  return `${year}-${month}-${day}T${timeMatch[0]}`;
}

/** "13/05/1993" -> "1993-05-13". Null se não bater no formato. */
export function toIsoDate(dateBr: string): string | null {
  const match = dateBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

// Telefone formatado "(47) 99637-8418" ou "(47) 3365-4046".
export const PHONE_FORMATTED = /\(\d{2}\)\s*\d{4,5}-?\d{4}/g;
// Telefone em sequência crua de dígitos, sem formatação — só quando isolado
// por palavra, pra não capturar pedaço de CNS ou de código de solicitação.
export const PHONE_RAW = /\b\d{10,11}\b/g;

/** Extrai todos os telefones (formatados ou crus) de um trecho de texto. */
export function extractPhones(text: string): string[] {
  const formatted = text.match(PHONE_FORMATTED) ?? [];
  // Remove os trechos já capturados antes de procurar dígitos crus, senão
  // um telefone formatado também bate como sequência de 10-11 dígitos.
  const withoutFormatted = formatted.reduce((acc, phone) => acc.replace(phone, " "), text);
  const raw = withoutFormatted.match(PHONE_RAW) ?? [];
  return [...formatted, ...raw];
}

/** "1a VEZ" / "1ª VEZ" -> true. "RETORNO" / "RETOR NO" -> false. Senão null. */
export function parseVaga(text: string): boolean | null {
  if (/1\s*[ªa]\s*VEZ/i.test(text)) return true;
  if (/RETOR\s*NO/i.test(text)) return false;
  return null;
}
