/*
  Cria o primeiro usuário da equipe, pra dar pra entrar no painel.

    npx tsx --env-file=.env prisma/seed.ts "Nome" email@dgs.com.br

  Sem senha no argumento: ela é gerada e impressa uma vez. Não passe senha
  pela linha de comando — fica no histórico do shell.
*/

import { PrismaClient } from "@prisma/client";
import { generateRandomPassword, hashPassword } from "../src/lib/auth.js";

const prisma = new PrismaClient();

async function main() {
  const [, , name, email] = process.argv;
  if (!name || !email) {
    console.error('Uso: npx tsx --env-file=.env prisma/seed.ts "Nome Completo" email@dominio.com');
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    console.error(`Já existe usuário com o e-mail ${normalizedEmail}.`);
    process.exit(1);
  }

  const password = generateRandomPassword(14);
  const user = await prisma.user.create({
    data: { name, email: normalizedEmail, passwordHash: hashPassword(password) },
  });

  console.log(`Usuário criado: ${user.name} <${user.email}>`);
  console.log(`Senha: ${password}`);
  console.log("\nAnote agora — ela não é exibida de novo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
