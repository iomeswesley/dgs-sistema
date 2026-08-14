/*
  Cadastra municípios e unidades de saúde básicas, a partir de endereços
  passados pelo usuário. Idempotente: roda de novo sem duplicar.

    npx tsx --env-file=.env scripts/cadastrar-unidades.ts
*/

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  for (const { municipality, unit, address } of UNITS) {
    const city = await prisma.municipality.upsert({
      where: { name_state: { name: municipality, state: "SC" } },
      update: {},
      create: { name: municipality, state: "SC" },
    });

    const existing = await prisma.healthUnit.findUnique({
      where: { municipalityId_name: { municipalityId: city.id, name: unit } },
    });

    if (existing) {
      await prisma.healthUnit.update({ where: { id: existing.id }, data: { address } });
      console.log(`Atualizado: ${unit} (${municipality}-SC)`);
    } else {
      await prisma.healthUnit.create({
        data: { municipalityId: city.id, name: unit, address },
      });
      console.log(`Criado: ${unit} (${municipality}-SC)`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
