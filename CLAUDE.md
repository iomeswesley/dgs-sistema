# Contexto do projeto — sistema-dgs

Leia isto no início de qualquer sessão nova. O desenho completo do produto está no [PLANO.md](PLANO.md) e os textos de WhatsApp em [TEMPLATES-WHATSAPP.md](TEMPLATES-WHATSAPP.md) — aqui ficam o estado atual e as convenções operacionais.

## O que é

Ferramenta **interna** da DGS (D'Artibale Gestão em Saúde), empresa que intermedia secretarias municipais de saúde e médicos contratados em SC. Recebe listas diárias de agendamento (PDF ou foto), extrai com IA, dispara confirmação por WhatsApp com botões Sim/Não e concilia o atendimento em três checagens.

Não é multi-tenant, não tem cobrança e não tem perfis de acesso: **perfil único**, todo mundo da equipe pode tudo. O controle vem da tabela `audit_logs`, não de permissões — decisão explícita do usuário.

- Repo: local, branch `master`. Sem remote configurado ainda.
- Deploy: previsto para Vercel (`vercel.json` + `api/index.js` já prontos). Ainda não publicado.
- Banco: Postgres/Supabase, **projeto novo e dedicado** — não reaproveitar o da barbearia-saas nem o do agendamento-quadra. Ainda não criado.

## Estado atual (2026-07-25)

Só o esqueleto está pronto. Nada de negócio foi implementado ainda.

**Pronto e validado** (typecheck + 23 testes + build limpos, UI conferida no navegador):
- Schema Prisma completo com todas as tabelas do plano (`prisma/schema.prisma`).
- Backend: `config/env.ts`, `lib/prisma`, `lib/auth` (scrypt), `lib/phone` (normalização E.164 + escolha do melhor número), `lib/whatsapp` (template com variáveis, assinatura do webhook fail-closed, leitura de respostas e de `statuses`), `lib/templates` (classificação da resposta), `lib/timezone`, `lib/errorReporting` (Sentry com scrub de PII).
- Middleware: sessão, auth, rate limit (persistido no Postgres), errorHandler, rawBody.
- Módulos: `auth` (login/logout/me com regeneração de sessão) e `audit` (trilha de alterações manuais).
- Frontend React/Vite/Tailwind v4: login, shell de navegação, 5 páginas com estados vazios, `StatusBand` (elemento-assinatura), `ConfirmModal`.

- **Extração das listas** (`src/modules/extraction/`): prompt calibrado nos dois formatos reais, schema da resposta, chamada ao Claude (PDF e imagem, structured output, streaming) e o mapeador que vira rascunho de agendamento com telefones normalizados e pendências apontadas. **A chamada real nunca foi executada** — falta `ANTHROPIC_API_KEY` e um arquivo de verdade; só o mapeador está coberto por teste.
- Scripts: `scripts/extrair.ts` (testa a extração num arquivo local) e `scripts/criar-templates-whatsapp.ts` (submete os 3 templates à Meta).

**Falta tudo o mais**: upload pelo painel, tela de revisão, fila de disparo, webhook, cadastros, fechamento, indicadores, export.

## Convenções de código

- **Antes de qualquer commit**: `npm run typecheck` (server + web) e `npm test` limpos.
- **Depois de validado, `git push` sem perguntar** — mesma instrução dos outros projetos do usuário. Ações destrutivas continuam exigindo confirmação.
- Backend segue o padrão da barbearia-saas: módulos em `src/modules/<nome>/` com `.routes.ts` / `.service.ts` / `.repository.ts`, alias `@/*` → `src/*`, rotas lançam `AppError` e deixam o `errorHandler` responder.
- **Nunca `alert()`/`window.confirm()`** — sempre `ConfirmModal` (`web/src/components/ConfirmModal.tsx`), inclusive para aviso de um botão só (`hideCancel`).
- Todo `<select>` usa a classe `.field`, que já traz `color-scheme: light dark` + fundo sólido. Sem isso o dropdown nativo abre branco no dark mode.
- Datas "de hoje" sempre por `localDateString()` (`src/lib/timezone.ts`), **nunca** `new Date().toISOString().split("T")[0]` — em UTC o dia vira antes da hora no Brasil.
- Cores: só `ink`/`ink-muted`/`sheet`/`board` e afins. **Verde, amarelo, vermelho e cinza são exclusivos de status de paciente** — não usar para nada decorativo, senão a cor perde o significado.

## Convenções operacionais

- **Dado de saúde é dado sensível na LGPD.** Nome + procedimento + CNS não podem aparecer em log, no Sentry (já tem scrub) nem em URL. CID-10 nunca vai para a mensagem de WhatsApp.
- **Nunca disparar WhatsApp real para telefone de paciente em teste.** Sem `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` o envio já vira log no console — desenvolver assim. Para testar de verdade, usar número próprio.
- Migrations: quando o banco existir, seguir o padrão da barbearia-saas — **nunca** `prisma migrate dev` (a tabela `session` criada em runtime pelo `connect-pg-simple` gera "drift" e o Prisma oferece resetar o banco). Criar a pasta de migration à mão e aplicar com `prisma migrate deploy`.
- Nunca aceitar chave/token/senha colada no chat — orientar configuração direto no dashboard (Supabase/Vercel/Meta).
- Manter este arquivo e o PLANO.md atualizados a cada mudança relevante.

## Notas técnicas que não são óbvias

- **A extração usa `claude-opus-5` com structured output** (`output_config.format` com JSON Schema escrito à mão, não derivado do zod — a API só aceita um subconjunto do JSON Schema). Precisa do `@anthropic-ai/sdk` ≥ 0.115: versões anteriores não tipam `output_config`. Streaming é obrigatório com `max_tokens` alto (64k) pra não estourar o timeout de HTTP.
- **O prompt de extração descreve a estrutura, não um roteiro de passos** — modelos atuais rendem menos com prompt prescritivo. Ao ajustar, manter a regra central: campo ilegível vira `null` com confiança baixa, nunca um chute.
- **`react-router-dom` fica na versão mais recente (7.18.x) mesmo com um aviso do `npm audit`.** O aviso é GHSA-2w69-qvjg-hvjx (CSRF em **RSC mode**), que não se aplica: usamos SPA com `BrowserRouter`, sem React Server Components nem server actions. A "correção" que o npm sugere é descer para 7.11.0, que é afetada por **13 outros** avisos. Não descer de versão.
- `@theme inline` no `index.css` mapeia os tokens do Tailwind para variáveis CSS próprias, que trocam no seletor `.dark`. Por isso as utilidades (`bg-sheet`, `text-ink`…) acompanham o tema sozinhas.
- O build do Vite sai em `dist-web/` e o Express serve dali em produção (`WEB_DIST` em `src/app.ts`); em dev são dois processos (`npm run dev` sobe os dois, com proxy `/api` do Vite para a porta 3000).
- `api/index.js` importa de `dist/`, não do TypeScript fonte — os aliases `@/...` já foram reescritos pelo `tsc-alias` no build.
- O webhook precisa tratar `statuses` (entrega/falha), diferente da barbearia-saas que os ignora: telefone errado na lista da prefeitura é rotina e vira indicador de qualidade devolvido à secretaria.

## Pendências externas (bloqueiam o desenvolvimento)

1. Projeto Supabase dedicado + `DATABASE_URL`/`DIRECT_URL` no `.env`.
2. Número de WhatsApp Business + app na Meta, e os **templates submetidos para aprovação** (maior lead time do projeto).
3. Chave da API Anthropic para a extração.
4. PDFs reais de 2–3 prefeituras para calibrar o prompt de extração (só fotos até agora).
5. Valores de `doctor_fee` e `city_rate` por procedimento.
