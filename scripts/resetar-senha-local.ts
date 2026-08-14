/*
  Reset de senha direto no banco -- só pra dev local, quando não há ninguém
  logado ainda pra usar o fluxo normal de "redefinir senha" da equipe.

    npx tsx --env-file=.env scripts/resetar-senha-local.ts email@dgs.local
*/
import { PrismaClient } from "@prisma/client";
import { generateRandomPassword, hashPassword } from "../src/lib/auth.js";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.toLowerCase().trim();
  if (!email) {
    console.error("Uso: npx tsx --env-file=.env scripts/resetar-senha-local.ts email@dgs.local");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Nenhum usuário com o e-mail ${email}.`);
    process.exit(1);
  }

  const password = generateRandomPassword(14);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) } });

  console.log(`Senha redefinida para ${user.name} <${user.email}>`);
  console.log(`Nova senha: ${password}`);
  console.log("\nAnote agora — ela não é exibida de novo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
