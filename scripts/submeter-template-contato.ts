/*
  Submete o template `novo_contato_site` (aviso interno de contato novo pela
  landing page) à WABA ativa do cliente LEAD_NOTIFY_CLIENT_ID (padrão: 1,
  "DGS"). Idempotente — duplicata é ignorada em silêncio.

    npx tsx --env-file=.env scripts/submeter-template-contato.ts
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { getActiveCredentials } from "../src/modules/whatsapp/whatsapp-account.service.js";
import { getTemplateStatuses, LEAD_NOTIFICATION_TEMPLATE, submitTemplates } from "../src/lib/whatsapp-templates.js";

async function main() {
  const clientId = Number(process.env.LEAD_NOTIFY_CLIENT_ID || 1);
  await runWithClient(clientId, async () => {
    const credentials = await getActiveCredentials();
    if (!credentials?.wabaId) {
      console.error("Cliente sem conta WhatsApp ativa com wabaId — nada pra submeter.");
      return;
    }
    console.log(`Submetendo "${LEAD_NOTIFICATION_TEMPLATE.name}" pra WABA ${credentials.wabaId}...`);
    await submitTemplates([LEAD_NOTIFICATION_TEMPLATE], credentials.wabaId, credentials.accessToken);
    const [status] = await getTemplateStatuses(credentials.wabaId, credentials.accessToken, [
      LEAD_NOTIFICATION_TEMPLATE.name,
    ]);
    console.log(`${status.name}: ${status.status}`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
