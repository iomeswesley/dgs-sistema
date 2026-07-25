import * as Sentry from "@sentry/node";
import { env, isProduction } from "@/config/env.js";

let initialized = false;

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
    // Dado de saúde é dado sensível na LGPD: nome de paciente, CNS e telefone
    // não podem sair do nosso banco em relatório de erro de terceiro.
    // sendDefaultPii desligado + scrub explícito do que costuma vazar em
    // query string e corpo de requisição.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.query_string) delete event.request.query_string;
      }
      return event;
    },
  });
  initialized = true;
}

export function captureError(err: unknown): void {
  if (!initialized) return;
  Sentry.captureException(err);
}

// Em serverless o processo pode ser congelado logo após a resposta, antes do
// Sentry conseguir despachar o evento pela rede.
export async function flushErrorReporting(): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(2000).catch(() => undefined);
}

export const errorReportingEnabled = initialized && isProduction;
