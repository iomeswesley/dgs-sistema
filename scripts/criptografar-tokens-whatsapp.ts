/*
  Migração pontual (2026-09-03): criptografa o `accessToken` de toda conta
  WhatsApp já gravada em texto puro no banco, achado na revisão de
  segurança de 2026-09-02 (ver CLAUDE.md e a memória
  seguranca-revisao-2026-09-02).

  Usa PrismaClient CRU (sem a extensão de criptografia de
  lib/prisma.ts) de propósito — ela criptografaria nesse mesmo ponto,
  então o script leria/escreveria o texto exatamente como está no banco,
  sem passar por ela duas vezes. Idempotente: pula qualquer linha cujo
  accessToken já comece com "v1:" (já criptografado), então rodar de novo
  não faz nada nas contas já migradas.

  Exige TOKEN_ENCRYPTION_KEY configurado no ambiente (senão `encryptSecret`
  não criptografa nada — ver lib/token-crypto.ts).

    npx tsx --env-file=.env scripts/criptografar-tokens-whatsapp.ts
*/
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/token-crypto.js";

const prisma = new PrismaClient();

async function main() {
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.error("TOKEN_ENCRYPTION_KEY não configurado no ambiente — nada seria criptografado. Abortando.");
    process.exit(1);
  }

  const accounts = await prisma.whatsappAccount.findMany({
    select: { id: true, label: true, businessName: true, accessToken: true, clientId: true },
  });

  let migrated = 0;
  let alreadyDone = 0;
  for (const account of accounts) {
    if (account.accessToken.startsWith("v1:")) {
      alreadyDone++;
      continue;
    }
    await prisma.whatsappAccount.update({
      where: { id: account.id },
      data: { accessToken: encryptSecret(account.accessToken) },
    });
    console.log(
      `Conta #${account.id} (cliente ${account.clientId}, ${account.label ?? account.businessName ?? "sem apelido"}) — criptografada.`
    );
    migrated++;
  }

  console.log(`\n${migrated} conta(s) criptografada(s), ${alreadyDone} já estava(m) criptografada(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
