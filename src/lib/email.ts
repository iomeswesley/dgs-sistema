import { Resend } from "resend";
import { env } from "@/config/env.js";

export const emailConfigured = !!env.RESEND_API_KEY;

const resend = emailConfigured ? new Resend(env.RESEND_API_KEY) : null;

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

/**
 * Envia um e-mail. Sem `RESEND_API_KEY`, vira log no console — mesmo padrão
 * do stub de WhatsApp, para não travar o desenvolvimento sem a credencial.
 *
 * O SDK do Resend não lança em erro da API — devolve `{ data, error }` e a
 * promise resolve normalmente. Sem checar isso à mão, uma falha de envio
 * (domínio não verificado, por exemplo) passaria em silêncio.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<void> {
  if (!resend) {
    console.log(`[EMAIL] (stub, RESEND_API_KEY não configurado) "${params.subject}" para ${params.to}`);
    return;
  }
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
    })),
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}
