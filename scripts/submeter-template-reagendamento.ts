/*
  Submete o template novo `reagendamento_consulta` (Template 5, ver
  TEMPLATES-WHATSAPP.md) à WABA ativa hoje em produção — pedido do usuário
  em 2026-09-08, botão "Reagendar" em Revisão.

  Reaproveita `submitDefaultTemplates()` (`src/lib/whatsapp-templates.ts`),
  a mesma automação que roda sozinha quando uma WABA NOVA conecta — mas
  essa WABA já existe de antes, então precisa rodar na mão uma vez.
  Tolerante a duplicata: os outros 4 templates já cadastrados nessa WABA
  são ignorados em silêncio (error_subcode 2388024), só o `reagendamento_
  consulta` é novo de verdade.

  Usa `getActiveCredentials()` — a MESMA fonte de credencial que o sistema
  usa pra enviar de verdade (prioriza a conta conectada via Embedded
  Signup no banco, decripta o token sozinha; só cai pro .env se não houver
  conta nenhuma) — não depende de WHATSAPP_BUSINESS_ACCOUNT_ID manual.

    npx tsx --env-file=.env scripts/submeter-template-reagendamento.ts
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { getActiveCredentials } from "../src/modules/whatsapp/whatsapp-account.service.js";
import { getTemplateStatuses, submitDefaultTemplates } from "../src/lib/whatsapp-templates.js";

async function main() {
  // Cliente 1 = "DGS", o único cliente real até aqui (multi-cliente,
  // ver CLAUDE.md) — é o dono da WABA ativa em produção.
  await runWithClient(1, async () => {
    const credentials = await getActiveCredentials();
    if (!credentials) {
      console.error("Nenhuma conta WhatsApp ativa (nem no banco, nem no .env) — nada pra submeter.");
      return;
    }
    if (!credentials.wabaId) {
      console.error(
        "Conta ativa não tem wabaId (é o fallback do .env) — configure WHATSAPP_BUSINESS_ACCOUNT_ID " +
          "e rode scripts/criar-templates-whatsapp.ts, ou conecte a conta pela tela primeiro."
      );
      return;
    }

    console.log(`Submetendo templates pra WABA ${credentials.wabaId}...`);
    await submitDefaultTemplates(credentials.wabaId, credentials.accessToken);

    const statuses = await getTemplateStatuses(credentials.wabaId, credentials.accessToken);
    console.log("\nStatus atual dos templates nessa WABA:");
    for (const status of statuses) {
      console.log(`  ${status.name}: ${status.status}`);
    }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
