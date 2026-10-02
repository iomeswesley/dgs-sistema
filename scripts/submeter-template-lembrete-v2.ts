/*
  Submete `lembrete_vespera_v2` (lembrete com "A guia do exame" e a orientação
  de conferir nela os documentos a levar — 02/10/2026) à WABA ativa do cliente 1
  (DGS). Nome novo de propósito: o `lembrete_vespera` aprovado segue sendo usado
  até este ficar APPROVED; só então troque TEMPLATE_NAMES.LEMBRETE em
  src/lib/templates.ts.

    npx tsx --env-file=.env scripts/submeter-template-lembrete-v2.ts
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { getActiveCredentials } from "../src/modules/whatsapp/whatsapp-account.service.js";
import { DEFAULT_TEMPLATES, getTemplateStatuses, submitTemplates } from "../src/lib/whatsapp-templates.js";

const NAME = "lembrete_vespera_v2";

async function main() {
  const template = DEFAULT_TEMPLATES.find((t) => t.name === NAME);
  if (!template) throw new Error(`${NAME} não está em DEFAULT_TEMPLATES.`);
  await runWithClient(1, async () => {
    const credentials = await getActiveCredentials();
    if (!credentials?.wabaId) {
      console.error("Sem conta WhatsApp ativa com wabaId — nada pra submeter.");
      return;
    }
    await submitTemplates([template], credentials.wabaId, credentials.accessToken);
    const [status] = await getTemplateStatuses(credentials.wabaId, credentials.accessToken, [NAME, "lembrete_vespera"]);
    console.log(`${status.name}: ${status.status}`);
    const [old] = await getTemplateStatuses(credentials.wabaId, credentials.accessToken, ["lembrete_vespera"]);
    console.log(`${old.name}: ${old.status}`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
