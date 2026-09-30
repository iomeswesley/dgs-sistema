/**
 * Base64 de um File pra mandar dentro de JSON (upload de PDF). btoa não
 * aceita a string inteira de uma vez em arquivos grandes; converter em
 * blocos evita estourar a pilha de argumentos.
 */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Tipo do arquivo pra mandar ao servidor. O navegador às vezes deixa
 * `file.type` vazio pra .xlsx (depende do sistema), então decide pela
 * extensão; o resto segue o que ele informa, com PDF como padrão.
 */
export function fileMimeType(file: File): string {
  if (/\.xlsx$/i.test(file.name)) return EXCEL_MIME;
  return file.type || "application/pdf";
}
