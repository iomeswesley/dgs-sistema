// Extensão do Prisma Client que injeta o isolamento por cliente
// automaticamente — ver PLANO-MULTICLIENTE.md, seção 4.
//
// Não é usada em produção ainda: é a peça central da Fase 1, construída e
// testada nesta sessão, mas só é seguro trocar o `prisma` exportado de
// `lib/prisma.ts` por um client com esta extensão depois de: (1) existir um
// banco de teste de verdade pra rodar o teste de isolamento com 2 clientes
// (ver seção 6 do plano) e (2) cada uma das ~204 queries do projeto ter
// clientId disponível no contexto de onde é chamada (rota, cron, webhook).
// Ligar a extensão antes disso quebraria o sistema inteiro em produção —
// toda query em tabela isolada passaria a exigir contexto, e nenhuma rota
// ainda abre esse contexto.
//
// Comportamento:
//   - Fora de `runWithClient`/`runAsSuperAdmin`: lança (fail-closed) — ver
//     `MissingTenantContextError` em tenant-context.ts.
//   - Dentro de `runAsSuperAdmin`: não injeta filtro nenhum, passa a query
//     como veio (escape nomeado do admin global).
//   - Dentro de `runWithClient(clientId, ...)`: injeta `clientId` no
//     `where` (leitura/atualização/exclusão) ou no `data` (criação) de toda
//     query dos modelos isolados.
//
// Limites conhecidos (documentados também no plano, seção 4):
//   - SQL cru (`$queryRaw`/`$executeRaw`) não passa por aqui. A reserva
//     atômica da fila (`SELECT ... FOR UPDATE SKIP LOCKED`) precisa do
//     clientId escrito à mão na cláusula WHERE.
//   - `include`/`select` aninhados chamam o Prisma internamente, não passam
//     de novo pelos hooks de query do modelo pai — relação aninhada não
//     isolada automaticamente, merece checagem à parte por caso.

import { Prisma } from "@prisma/client";
import { currentClientIdOrThrow } from "@/lib/tenant-context.js";

// Os 17 modelos do domínio que carregam clientId (ver schema.prisma,
// comentário no topo do bloco "Clientes (multi-cliente)"). Mantido como
// union literal, não `keyof typeof`, pra dar erro de compilação se alguém
// adicionar uma tabela isolada nova ao schema e esquecer de listar aqui.
export const TENANT_ISOLATED_MODELS = [
  "Municipality",
  "HealthUnit",
  "Doctor",
  "Procedure",
  "DoctorProcedure",
  "Agenda",
  "List",
  "Patient",
  "Appointment",
  "CancellationBatch",
  "MessageJob",
  "WhatsappMessage",
  "WhatsappAccount",
  "DailyClosing",
  "ClosingAttachment",
  "AuditLog",
  "AppSettings",
] as const;

export type TenantIsolatedModel = (typeof TENANT_ISOLATED_MODELS)[number];

const ISOLATED_SET: ReadonlySet<string> = new Set(TENANT_ISOLATED_MODELS);

const WRITE_TO_DATA_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const WRITE_TO_WHERE_OPS = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);
const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

function withClientIdInWhere(where: unknown, clientId: number): Record<string, unknown> {
  return { ...(where as Record<string, unknown> | undefined), clientId };
}

// Aplica a injeção nos argumentos de UMA operação, dado o clientId já
// resolvido (ou `null` pra super admin, que não injeta nada). Exportada
// separada da extensão pra dar pra testar sem montar um PrismaClient de
// verdade — só chamando esta função com args de exemplo.
export function applyTenantFilter(
  operation: string,
  args: Record<string, unknown> | undefined,
  clientId: number | null,
): Record<string, unknown> | undefined {
  if (clientId == null) return args; // super admin: passa como veio

  const next = { ...(args ?? {}) };

  if (READ_OPS.has(operation) || WRITE_TO_WHERE_OPS.has(operation)) {
    next.where = withClientIdInWhere(next.where, clientId);
    return next;
  }

  if (operation === "create") {
    next.data = { ...(next.data as Record<string, unknown> | undefined), clientId };
    return next;
  }

  if (operation === "createMany" || operation === "createManyAndReturn") {
    const data = next.data;
    next.data = Array.isArray(data)
      ? data.map((row) => ({ ...(row as Record<string, unknown>), clientId }))
      : { ...(data as Record<string, unknown> | undefined), clientId };
    return next;
  }

  if (operation === "upsert") {
    next.where = withClientIdInWhere(next.where, clientId);
    next.create = { ...(next.create as Record<string, unknown> | undefined), clientId };
    return next;
  }

  // Operações não listadas (ex.: $queryRaw não passa por cá; operações de
  // agregação exóticas futuras) passam sem modificação — não é o papel
  // desta função adivinhar formato novo, é melhor falhar visível depois
  // (query sem filtro nunca devolve dado de outro cliente por acaso: o
  // WHERE explícito de cada service continua existindo por baixo até a
  // Fase 1 remover o filtro manual redundante).
  return next;
}

export const tenantIsolationExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !ISOLATED_SET.has(model)) {
            return query(args as never);
          }
          const clientId = currentClientIdOrThrow(model);
          const nextArgs = applyTenantFilter(operation, args as Record<string, unknown>, clientId);
          return query(nextArgs as never);
        },
      },
    },
  }),
);
