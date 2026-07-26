import { z } from "zod";

// Falha rápido na inicialização se faltar variável obrigatória, em vez de
// deixar o erro aparecer só na primeira requisição que precisar dela.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),
  // Conexão direta (sem pooler em modo transaction) — exigida pelo Prisma
  // Migrate. No Supabase é a URL na porta 5432, não a 6543.
  DIRECT_URL: z.string().min(1, "DIRECT_URL é obrigatório"),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET é obrigatório"),
  PUBLIC_BASE_URL: z.string().optional(),
  CRON_SECRET: z.string().optional(),

  // Extração das listas (PDF/foto) — sem a chave, o upload aceita o arquivo
  // mas a extração fica desligada e a lista precisa ser preenchida à mão.
  ANTHROPIC_API_KEY: z.string().optional(),

  // WhatsApp Cloud API (Meta). Sem token, o envio vira stub que só loga no
  // console — permite desenvolver o fluxo inteiro sem risco de mandar
  // mensagem real pra telefone de paciente. Em produção, ACCESS_TOKEN e
  // PHONE_NUMBER_ID normalmente vêm do Embedded Signup (tabela
  // WhatsappAccount) em vez do .env — essas duas variáveis seguem existindo
  // só pro fluxo de desenvolvimento/sandbox sem passar pela tela de conectar.
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  // App ID (público, não é segredo — vai pro frontend) e o Configuration ID
  // do Embedded Signup, criados no App Dashboard da Meta (WhatsApp →
  // Configuração da API → Embedded Signup). Sem os dois, o botão "Conectar
  // WhatsApp" não aparece nas Configurações.
  WHATSAPP_APP_ID: z.string().optional(),
  WHATSAPP_SIGNUP_CONFIG_ID: z.string().optional(),
  // Teto de mensagens por dia — fallback quando a consulta à Graph API falha
  // ou não há conta conectada (sandbox/dev). Em produção, o limite real vem
  // do messaging_limit_tier do número (ver whatsapp-account.service.ts),
  // que a própria Meta sobe sozinha conforme o histórico de qualidade.
  WHATSAPP_DAILY_LIMIT: z.coerce.number().int().positive().default(250),

  // E-mail transacional (recuperação de senha). Sem chave, o link é só
  // registrado no console.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("onboarding@resend.dev"),

  SENTRY_DSN: z.string().optional(),

  VERCEL: z
    .string()
    .optional()
    .transform((v) => v === "1"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuração de ambiente inválida:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
