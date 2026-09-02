/*
  Cadastra municípios e unidades de saúde básicas, a partir de endereços
  passados pelo usuário. Idempotente: roda de novo sem duplicar.

    npx tsx --env-file=.env scripts/cadastrar-unidades.ts --cliente=DGS

  Usa o `prisma` isolado (não um PrismaClient cru) — desde a Fase 0 do
  plano multi-cliente, Municipality/HealthUnit são por cliente
  (`@@unique([clientId, ...])`), então toda escrita precisa saber pra
  qual cliente é.
*/

import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";

const clienteArg = process.argv.find((a) => a.startsWith("--cliente="))?.split("=")[1];
if (!clienteArg) {
  console.error("Informe --cliente=<nome> (ver Client.name em /admin ou no banco).");
  process.exit(1);
}

const UNITS: { municipality: string; unit: string; address: string }[] = [
  {
    municipality: "Blumenau",
    unit: "POLICLÍNICA LINDOLF BELL",
    address: "Rua Dois de Setembro, n°1234 - Blumenau-SC",
  },
  {
    municipality: "Blumenau",
    unit: "CENTRO ROSANIA MACHADO",
    address: "Rua Dois de Setembro, n°1212 - Blumenau-SC",
  },
  {
    municipality: "Indaial",
    unit: "SAIS",
    address: "Rua Leoberto Leal, 155, bairro Tapajós - Indaial-SC",
  },
];

async function main() {
  const client = await prisma.client.findUnique({ where: { name: clienteArg } });
  if (!client) {
    console.error(`Cliente "${clienteArg}" não encontrado.`);
    process.exit(1);
  }

  await runWithClient(client.id, async () => {
    for (const { municipality, unit, address } of UNITS) {
      const city = await prisma.municipality.upsert({
        where: { clientId_name_state: { clientId: client.id, name: municipality, state: "SC" } },
        update: {},
        create: { clientId: client.id, name: municipality, state: "SC" },
      });

      const existing = await prisma.healthUnit.findUnique({
        where: { municipalityId_name: { municipalityId: city.id, name: unit } },
      });

      if (existing) {
        await prisma.healthUnit.update({ where: { id: existing.id }, data: { address } });
        console.log(`Atualizado: ${unit} (${municipality}-SC)`);
      } else {
        await prisma.healthUnit.create({
          data: { clientId: client.id, municipalityId: city.id, name: unit, address },
        });
        console.log(`Criado: ${unit} (${municipality}-SC)`);
      }
    }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
