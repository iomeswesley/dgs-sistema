import crypto from "node:crypto";
import { env } from "@/config/env.js";

// Criptografia de segredos guardados no banco (hoje só o accessToken do
// WhatsApp, `WhatsappAccount.accessToken`) — acrescentado em 2026-09-03
// depois de achar, numa revisão de segurança, que o token ficava em texto
// puro no Postgres: quem lesse o banco direto (dump, backup, acesso ao
// Supabase) conseguia mandar WhatsApp em nome do cliente. Ver
// [MEMORY] seguranca-revisao-2026-09-02.
//
// AES-256-GCM: autenticado (`authTag`), não só cifrado — decriptar um
// valor adulterado lança em vez de devolver lixo. Chave em
// TOKEN_ENCRYPTION_KEY, deliberadamente separada de SESSION_SECRET —
// comprometer um segredo não deve comprometer o outro.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado pro GCM (96 bits)
const PREFIX = "v1"; // versão do formato, pra permitir trocar de algoritmo no futuro sem quebrar dado já gravado

let warnedNoKey = false;

function getKey(): Buffer | null {
  if (!env.TOKEN_ENCRYPTION_KEY) return null;
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY inválido — precisa decodificar (base64) pra exatamente 32 bytes (AES-256). Gerar um novo com: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  return key;
}

/**
 * Criptografa um segredo antes de gravar no banco. Sem `TOKEN_ENCRYPTION_KEY`
 * configurado (ex.: máquina de dev sem essa variável), devolve o texto puro
 * — não quebra o fluxo local, só não protege (avisa uma vez no console pra
 * não passar despercebido). Em produção a chave deve sempre estar
 * configurada.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    if (!warnedNoKey) {
      console.warn(
        "[token-crypto] TOKEN_ENCRYPTION_KEY não configurado — segredo sendo gravado em texto puro. Configurar antes de operar em produção."
      );
      warnedNoKey = true;
    }
    return plaintext;
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * Decripta um valor gravado por `encryptSecret`. Tolerante a dado legado:
 * qualquer string que não comece com o prefixo de versão (`v1:`) é tratada
 * como texto puro gravado antes desta migração e devolvida como veio — não
 * trava a leitura de contas conectadas antes da criptografia existir.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(`${PREFIX}:`)) return stored; // legado: gravado antes de 2026-09-03, sem criptografia

  const key = getKey();
  if (!key) {
    throw new Error(
      "Segredo está criptografado (prefixo 'v1:') mas TOKEN_ENCRYPTION_KEY não está configurado — não dá pra decriptar."
    );
  }
  const parts = stored.split(":");
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  if (parts.length !== 4 || !ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Formato de segredo criptografado inválido — esperado 'v1:iv:authTag:ciphertext'.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
