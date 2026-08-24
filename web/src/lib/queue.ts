import { api } from "./api";

export interface QueueProcessResult {
  sent: number;
  failed: number;
  deferred: number;
  remainingToday: number;
  dueNow: number;
}

/**
 * Chama `POST /api/queue/process` repetidamente até esvaziar o que já está
 * no horário de sair (`dueNow`), em vez de uma chamada só.
 *
 * Existe por causa do achado de 2026-08-26: um disparo de 109 cancelamentos
 * foi morto pelo `maxDuration` de 60s da função na Vercel no meio do
 * processamento — a tela mostrou "não foi possível completar a ação" mesmo
 * com o disparo tendo sido criado de verdade, e 61 pacientes só teriam sido
 * avisados no dia seguinte, quando o cron rodasse sozinho. Uma lista/
 * cancelamento grande não cabe com segurança numa chamada só (o próprio
 * `processQueue` já pára sozinho perto do limite, ver `TIME_BUDGET_MS` em
 * `queue.service.ts`) — por isso o acabamento fica por conta do navegador,
 * repetindo a chamada em requisições separadas (cada uma sob o limite de
 * tempo da função) até não sobrar mais nada pra agora. Nunca depende do
 * cron do dia seguinte pra terminar um disparo de hoje.
 */
export async function runQueueUntilDone(
  onProgress?: (accumulated: { sent: number; failed: number }) => void
): Promise<{ sent: number; failed: number; remainingToday: number }> {
  let totalSent = 0;
  let totalFailed = 0;
  let remainingToday = 0;

  // Teto de segurança pra nunca girar pra sempre por causa de algum bug —
  // 500 chamadas já cobrem uma fila bem maior do que qualquer lista real.
  for (let round = 0; round < 500; round++) {
    const result = await api.post<QueueProcessResult>("/api/queue/process");
    totalSent += result.sent;
    totalFailed += result.failed;
    remainingToday = result.remainingToday;
    onProgress?.({ sent: totalSent, failed: totalFailed });

    if (result.dueNow === 0) break;
    // Nada foi processado nessa rodada mas ainda tem due now (ex.: erro
    // silencioso) — pára pra não martelar a API sem sair do lugar.
    if (result.sent === 0 && result.failed === 0) break;
  }

  return { sent: totalSent, failed: totalFailed, remainingToday };
}
