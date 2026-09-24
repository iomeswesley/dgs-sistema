import { z } from "zod";
import { describePhoneIssue, normalizePhone } from "@/lib/phone.js";

// Formulário público da landing page — mensagens em português, sem nome de
// campo na frente (quem lê é um visitante, não a equipe).
export const contactLeadSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120, "Nome muito longo."),
  organization: z
    .string()
    .trim()
    .min(2, "Informe a secretaria ou o município.")
    .max(160, "Secretaria/município muito longo."),
  role: z.string().trim().max(120, "Cargo muito longo.").optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!normalizePhone(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: describePhoneIssue(value) });
    }),
  email: z.string().trim().email("E-mail inválido.").max(160, "E-mail muito longo."),
  message: z.string().trim().max(2000, "Mensagem muito longa (máx. 2.000 caracteres).").optional().or(z.literal("")),
  consent: z.literal(true, { errorMap: () => ({ message: "É preciso autorizar o contato para enviar." }) }),
  // Campo-isca: escondido na página, só robô preenche.
  website: z.string().optional(),
});

export type ContactLeadInput = z.infer<typeof contactLeadSchema>;

export function isHoneypotFilled(input: { website?: string }): boolean {
  return Boolean(input.website && input.website.trim());
}
