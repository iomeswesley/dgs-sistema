const DIACRITICS = /[̀-ͯ]/g;

/** Nome de arquivo seguro: sem acento, minúsculo, espaços/pontuação viram "-". */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
