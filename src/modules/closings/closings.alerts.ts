/*
  Detecção de números que não fecham.

  Módulo puro de propósito — sem banco, sem env — porque é a regra que decide
  se um pagamento sai certo ou errado, e precisa ser testável isolada.
*/

export interface ClosingNumbers {
  planned: number;
  confirmed: number;
  attendedReported: number | null;
  paidCount: number | null;
  extrasCount: number;
}

/** Acima disso a diferença entre o médico e as guias vira alerta. */
const DIVERGENCE_THRESHOLD = 0.1;

/**
 * O objetivo é a equipe ver a inconsistência na hora do lançamento, não
 * descobrir no fechamento do mês.
 */
export function buildAlerts(row: ClosingNumbers): string[] {
  const alerts: string[] = [];

  if (row.attendedReported !== null) {
    const ceiling = row.confirmed + row.extrasCount;
    if (row.attendedReported > ceiling) {
      alerts.push(
        `Atendidos (${row.attendedReported}) acima de confirmados + encaixes (${ceiling}). Faltou lançar encaixe?`
      );
    }
    if (row.attendedReported > row.planned + row.extrasCount) {
      alerts.push(`Atendidos (${row.attendedReported}) acima do total da lista (${row.planned}).`);
    }
  }

  if (row.paidCount !== null && row.attendedReported !== null) {
    if (row.paidCount > row.attendedReported) {
      alerts.push(`Guias (${row.paidCount}) acima do que o médico informou (${row.attendedReported}).`);
    } else if (row.attendedReported > 0) {
      const divergence = (row.attendedReported - row.paidCount) / row.attendedReported;
      if (divergence > DIVERGENCE_THRESHOLD) {
        alerts.push(
          `Divergência de ${Math.round(divergence * 100)}% entre médico e guias (${row.attendedReported} × ${row.paidCount}).`
        );
      }
    }
  }

  return alerts;
}
