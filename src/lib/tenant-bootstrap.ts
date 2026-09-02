// Bootstrap temporário do Fase 1 do plano multi-cliente — ver
// PLANO-MULTICLIENTE.md, seções 3.2 e 3.3.
//
// Hoje só existe UM cliente de verdade ("DGS"). Cron e webhook do WhatsApp
// ainda não sabem resolver o cliente certo sozinhos:
//   - cron: devia iterar clientes ativos (Fase 2)
//   - webhook: devia resolver clientId a partir de
//     metadata.phone_number_id, achado 3.2 do plano (Fase 2)
//
// Até a Fase 2 acontecer, os dois usam esta função — pega o único cliente
// ativo que existe. Fail LOUD (não fail-closed silencioso) se já houver
// mais de um: é o sinal de que a Fase 2 precisa estar pronta ANTES de
// operar um segundo cliente de verdade, não descoberto depois com dado
// vazando entre eles.
import { prisma } from "@/lib/prisma.js";

export async function resolveSoleActiveClientId(): Promise<number> {
  const clients = await prisma.client.findMany({
    where: { active: true },
    select: { id: true },
  });
  if (clients.length === 0) {
    throw new Error(
      "Nenhum cliente ativo encontrado — banco sem o cliente 'DGS'? (ver migration 20260902000000_multicliente_fase0).",
    );
  }
  if (clients.length > 1) {
    throw new Error(
      `Existem ${clients.length} clientes ativos, mas cron/webhook ainda usam o bootstrap de cliente ` +
        `único (resolveSoleActiveClientId, src/lib/tenant-bootstrap.ts). A Fase 2 do PLANO-MULTICLIENTE.md ` +
        `(webhook por phone_number_id, cron por cliente) precisa estar pronta antes de operar um segundo ` +
        `cliente de verdade — não dá pra saber qual dos ${clients.length} processar.`,
    );
  }
  return clients[0]!.id;
}
