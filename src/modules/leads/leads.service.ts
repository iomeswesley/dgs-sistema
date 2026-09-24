import { env } from "@/config/env.js";
import { prisma } from "@/lib/prisma.js";
import { formatPhone, normalizePhone } from "@/lib/phone.js";
import { runWithClient } from "@/lib/tenant-context.js";
import { sendTemplate } from "@/lib/whatsapp.js";
import { LEAD_NOTIFICATION_TEMPLATE } from "@/lib/whatsapp-templates.js";
import type { ContactLeadInput } from "@/modules/leads/leads.schema.js";

export async function createContactLead(input: ContactLeadInput): Promise<void> {
  const phone = normalizePhone(input.phone)!;
  const lead = await prisma.contactLead.create({
    data: {
      name: input.name,
      organization: input.organization,
      role: input.role || null,
      phone: phone.e164,
      email: input.email.toLowerCase(),
      message: input.message || null,
    },
  });

  // Best-effort: o contato já está salvo; falha aqui (template ainda não
  // aprovado, sem conta ativa) só deixa notifiedAt vazio.
  if (!env.LEAD_NOTIFY_PHONE || !env.LEAD_NOTIFY_CLIENT_ID) return;
  const to = normalizePhone(env.LEAD_NOTIFY_PHONE);
  if (!to) return;
  try {
    const result = await runWithClient(env.LEAD_NOTIFY_CLIENT_ID, () =>
      sendTemplate(to.e164, LEAD_NOTIFICATION_TEMPLATE.name, {
        body: [lead.name, lead.organization, formatPhone(lead.phone)],
      })
    );
    if (!result.stubbed) {
      await prisma.contactLead.update({ where: { id: lead.id }, data: { notifiedAt: new Date() } });
    }
  } catch (err) {
    console.error(`[LEADS] Falha ao avisar contato #${lead.id} por WhatsApp:`, (err as Error).message);
  }
}

export async function listContactLeads() {
  const leads = await prisma.contactLead.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return leads.map((lead) => ({ ...lead, phone: formatPhone(lead.phone) }));
}
