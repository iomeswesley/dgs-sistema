/*
  Reaplica, na WABA ativa de um cliente, os templates com o nome do remetente
  dele (rodapé + apresentação sem "DGS"). Edita os templates que já existem
  (a Meta não deixa resubmeter o mesmo nome); template aprovado editado volta
  pra revisão (~24h).

    npx tsx --env-file=.env scripts/rebrand-templates-cliente.ts <clientId> ["Nome do remetente"]

  Sem o 2º argumento usa AppSettings.senderName do cliente.
*/
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";
import { brandTemplates, DEFAULT_TEMPLATES, editTemplates } from "../src/lib/whatsapp-templates.js";

async function main() {
  const clientId = Number(process.argv[2]);
  if (!clientId) throw new Error("Informe o clientId.");
  await runWithClient(clientId, async () => {
    const settings = await prisma.appSettings.findUnique({ where: { clientId } });
    const sender = process.argv[3] ?? settings?.senderName;
    if (!sender) throw new Error("Cliente sem senderName — passe o nome como 2º argumento.");
    const account = await prisma.whatsappAccount.findFirst({ where: { active: true } });
    if (!account) throw new Error("Cliente sem conta WhatsApp ativa.");
    const results = await editTemplates(brandTemplates(DEFAULT_TEMPLATES, sender), account.wabaId, account.accessToken);
    console.log(`Remetente: ${sender}`);
    for (const r of results) console.log(r.ok ? "OK  " : "ERRO", r.name, r.detail ?? "");
  });
}
main().finally(() => prisma.$disconnect());
