// Contexto de cliente por requisição — ver PLANO-MULTICLIENTE.md, seção 4.
//
// Usa AsyncLocalStorage (nativo do Node, sem dependência nova) pra carregar
// o `clientId` ativo durante toda a vida de uma requisição, sem precisar
// passar esse valor manualmente por cada função — quem lê o contexto é a
// extensão do Prisma (`tenant-prisma-extension.ts`), não cada service.
//
// Três formas de entrar em contexto:
//   - `runWithClient(clientId, fn)` — o caso normal, uma requisição de
//     usuário autenticado num cliente (o middleware chama isso).
//   - `runAsSuperAdmin(fn)` — escape nomeado e explícito pro admin global
//     (ver PLANO-MULTICLIENTE.md seção 4, item 4): a extensão do Prisma não
//     injeta filtro nenhum dentro desse escopo. Precisa ser chamado com
//     intenção — nunca é o padrão.
//   - Nenhum dos dois (contexto vazio) — é o estado fail-closed: qualquer
//     query numa tabela isolada dispara erro em vez de devolver o banco
//     inteiro. Cron e webhook abrem contexto explicitamente por fora de
//     uma requisição HTTP (ver PLANO-MULTICLIENTE.md seção 4).

import { AsyncLocalStorage } from "node:async_hooks";

interface TenantContext {
  clientId: number | null;
  isSuperAdmin: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

// IMPORTANTE — por que estas duas funções são `async` e sempre fazem
// `await fn()` por dentro, mesmo quando `fn` não é assíncrona:
//
// As queries do Prisma são "preguiçosas" (`createPrismaPromise`): chamar
// `prisma.modelo.findMany(...)` não dispara nada sozinho, só monta um
// objeto — o Prisma (e por consequência a extensão de isolamento, ver
// tenant-prisma-extension.ts) só executa de verdade quando alguém chama
// `.then()`/`await` nesse objeto. O `AsyncLocalStorage.run(store, cb)` do
// Node só garante contexto pras continuações que nascem DENTRO da execução
// de `cb` — se `cb` for síncrona e só `return prisma.x.findMany()` (sem
// `await`), o `.then()` de quem chamou `runWithClient(...)` acontece DEPOIS
// que `run()` já retornou, ou seja, FORA do contexto. Resultado: a extensão
// lançaria `MissingTenantContextError` mesmo com `runWithClient` "por
// cima" — bug real, pego pelo teste de integração com banco de verdade
// (`tenant-isolation.integration.test.ts`) antes de qualquer coisa ir pra
// produção. Fazendo o `await fn()` aqui dentro, o `.then()` sempre
// acontece enquanto o `run()` ainda está com o contexto ativo,
// independente de como quem chama escreveu `fn`.
export async function runWithClient<T>(clientId: number, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ clientId, isSuperAdmin: false }, async () => await fn());
}

export async function runAsSuperAdmin<T>(fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ clientId: null, isSuperAdmin: true }, async () => await fn());
}

// Erro dedicado (não `Error` genérico) pra fail-closed ficar fácil de
// distinguir em teste e no errorHandler — nunca deve aparecer em produção
// fora de bug de programação (rota esqueceu o middleware, ou script solto
// rodando sem abrir contexto nenhum).
export class MissingTenantContextError extends Error {
  constructor(model: string) {
    super(
      `Query em "${model}" sem contexto de cliente — falta runWithClient/runAsSuperAdmin. ` +
        `Nunca devolve o banco inteiro em silêncio (ver PLANO-MULTICLIENTE.md seção 4).`,
    );
    this.name = "MissingTenantContextError";
  }
}

// Lida pela extensão do Prisma a cada query numa tabela isolada.
// - super admin: `null` => a extensão não injeta filtro nenhum.
// - cliente normal: o `clientId` ativo.
// - sem contexto nenhum: lança (fail-closed).
export function currentClientIdOrThrow(model: string): number | null {
  const ctx = storage.getStore();
  if (!ctx) throw new MissingTenantContextError(model);
  if (ctx.isSuperAdmin) return null;
  if (ctx.clientId == null) throw new MissingTenantContextError(model);
  return ctx.clientId;
}

// Pra código que já está dentro de uma requisição autenticada e só quer o
// valor pra montar uma mensagem de erro, log, etc. — não pra filtrar query
// (isso é papel da extensão). Lança fora de contexto de cliente normal
// (inclusive dentro de `runAsSuperAdmin`, que não tem um clientId único).
export function requireActiveClientId(): number {
  const ctx = storage.getStore();
  if (!ctx || ctx.clientId == null) {
    throw new Error("requireActiveClientId chamado fora de runWithClient — sem cliente ativo.");
  }
  return ctx.clientId;
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}
