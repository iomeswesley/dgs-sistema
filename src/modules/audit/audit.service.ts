import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";

export interface AuditEntry {
  userId: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
  /**
   * Só pra ações do admin global (Fase 4), chamadas de DENTRO de um
   * `runAsSuperAdmin` já aberto (`requireSuperAdmin`) — nesse contexto não
   * existe UM `activeClientId` pra puxar sozinho, então o chamador informa
   * explicitamente a QUAL cliente o evento pertence (o cliente sendo
   * criado/editado, ou o clientId de um acesso concedido/revogado).
   *
   * ⚠️ NÃO substitui abrir contexto — `AuditLog` é um modelo isolado, e a
   * extensão do Prisma exige `runWithClient`/`runAsSuperAdmin` ativo pra
   * QUALQUER escrita nele, além do que está em `data` (ver
   * tenant-prisma-extension.ts). Chamar `recordAudit({ clientId: X, ... })`
   * fora de qualquer um dos dois ainda lança fail-closed — foi exatamente
   * esse engano que quebrou a auditoria do login em silêncio (só corrigido
   * de verdade abrindo `runWithClient` ao redor da chamada em
   * auth.routes.ts, não só passando o campo). Toda ação normal (a
   * esmagadora maioria, já dentro do `runWithClient` que `requireAuth`
   * abre) não precisa deste campo: puxa sozinho do `activeClientId` da
   * sessão.
   */
  clientId?: number;
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Registra uma alteração manual. Como não há perfis separados (toda a equipe
 * tem os mesmos poderes), esta trilha é o único controle sobre quem lançou o
 * quê — em especial nos checks 2 e 3, que viram pagamento.
 *
 * Nunca falha a operação principal: um erro ao gravar auditoria é logado e
 * engolido, porque perder o lançamento seria pior que perder o registro dele.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clientId: entry.clientId ?? requireActiveClientId(),
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        field: entry.field ?? null,
        oldValue: stringify(entry.oldValue),
        newValue: stringify(entry.newValue),
        metadata: (entry.metadata ?? undefined) as never,
      },
    });
  } catch (err) {
    console.error("[AUDIT] Falha ao gravar trilha de auditoria:", (err as Error).message, entry);
  }
}

/**
 * Compara dois objetos e registra uma entrada por campo alterado — usado nas
 * telas de lançamento, onde saber que "paidCount mudou de 18 pra 22" importa
 * mais do que saber que "o fechamento foi editado".
 */
export async function recordFieldChanges(
  base: Omit<AuditEntry, "field" | "oldValue" | "newValue">,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<void> {
  for (const [field, newValue] of Object.entries(after)) {
    const oldValue = before[field];
    if (stringify(oldValue) === stringify(newValue)) continue;
    await recordAudit({ ...base, field, oldValue, newValue });
  }
}
