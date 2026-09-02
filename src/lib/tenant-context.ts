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

export function runWithClient<T>(clientId: number, fn: () => T): T {
  return storage.run({ clientId, isSuperAdmin: false }, fn);
}

export function runAsSuperAdmin<T>(fn: () => T): T {
  return storage.run({ clientId: null, isSuperAdmin: true }, fn);
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
