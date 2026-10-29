/*
  Submete o template `oferta_consulta` (fluxo OFERTA, 2026-10-29) à WABA ativa
  do cliente 1 e lista o status dos templates. Idempotente: nome já existente
  é ignorado em silêncio (error_subcode 2388024). Mesma fonte de credencial do
  envio real (`getActiveCredentials()`).

    npx tsx --env-file=.env scripts/submeter-template-oferta.ts
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { getActiveCredentials } from "../src/modules/whatsapp/whatsapp-account.service.js";
import { DEFAULT_TEMPLATES, getTemplateStatuses, submitTemplates } from "../src/lib/whatsapp-templates.js";

async function main() {
  await runWithClient(1, async () => {
    const credentials = await getActiveCredentials();
    if (!credentials?.wabaId) {
      console.error("Sem conta WhatsApp ativa com wabaId — nada pra submeter.");
      return;
    }
    const oferta = DEFAULT_TEMPLATES.filter((t) => t.name === "oferta_consulta");
    console.log(`Submetendo oferta_consulta pra WABA ${credentials.wabaId}...`);
    await submitTemplates(oferta, credentials.wabaId, credentials.accessToken);

    const statuses = await getTemplateStatuses(credentials.wabaId, credentials.accessToken);
    for (const s of statuses) console.log(`  ${s.name}: ${s.status}${s.category ? ` (${s.category})` : ""}`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
