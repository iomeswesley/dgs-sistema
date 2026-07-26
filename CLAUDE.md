# Contexto do projeto — sistema-dgs

Leia isto no início de qualquer sessão nova. O desenho completo do produto está no [PLANO.md](PLANO.md) e os textos de WhatsApp em [TEMPLATES-WHATSAPP.md](TEMPLATES-WHATSAPP.md) — aqui ficam o estado atual e as convenções operacionais.

## O que é

Ferramenta **interna** da DGS (D'Artibale Gestão em Saúde), empresa que intermedia secretarias municipais de saúde e médicos contratados em SC. Recebe listas diárias de agendamento (PDF ou foto), extrai com IA, dispara confirmação por WhatsApp com botões Sim/Não e concilia o atendimento em três checagens.

Não é multi-tenant, não tem cobrança e não tem perfis de acesso: **perfil único**, todo mundo da equipe pode tudo. O controle vem da tabela `audit_logs`, não de permissões — decisão explícita do usuário.

- Repo: [github.com/iomeswesley/dgs-sistema](https://github.com/iomeswesley/dgs-sistema) (privado), branch `master`.
- Deploy: previsto para Vercel (`vercel.json` + `api/index.js` já prontos). Ainda não publicado.
- Banco de **produção**: Postgres/Supabase, **projeto novo e dedicado** — não reaproveitar o da barbearia-saas nem o do agendamento-quadra. Ainda não criado.
- Banco de **dev local**: PostgreSQL 17 instalado na máquina via winget (serviço Windows `postgresql-x64-17`, sempre rodando), banco `sistema_dgs`, usuário `postgres` senha `dgs_local_dev`. `.env` local já existe (não versionado) apontando pra ele — ver seção "Ambiente local" abaixo antes de recriar nada.

## Estado atual (2026-07-25)

**Fase 1 e Fase 2 do PLANO.md implementadas por inteiro.** Falta só ligar às credenciais reais de produção — ver [INSTALACAO.md](INSTALACAO.md). O fluxo já foi **validado rodando de verdade**: login funcionando com sessão real, banco local com as migrations aplicadas, navegação testada no navegador.

Validado: typecheck (server + web), 62 testes e build limpos; login e navegação conferidos no navegador contra banco real.

## Ambiente local (já configurado nesta máquina)

- Postgres local rodando (ver acima). `.env` na raiz do projeto (git-ignorado) já tem `DATABASE_URL`/`DIRECT_URL` apontando pra ele, `SESSION_SECRET` gerado, e o resto das chaves (Anthropic/WhatsApp/Resend) vazias — então extração, WhatsApp e e-mail caem nos stubs (log no console), mas login/cadastro/navegação funcionam de ponta a ponta.
- Usuário de teste já criado: `wesley@dgs.local`. Senha gerada uma vez pelo `npm run seed` — se perdida, gerar outra com `npm run seed -- "Nome" outro-email@dgs.local` (não reseta a existente) ou redefinir depois de logar com outra conta.
- **Corrigido**: `npm run dev:api` agora força `PORT=3000` via `cross-env`, porque o harness de preview injeta `PORT=5173` (a porta do Vite) no ambiente e o `--env-file` do Node não sobrescreve variável já existente — sem o `cross-env` a API tentava subir na mesma porta do Vite e o login falhava com 502. Não reverter esse script.
- Pra rodar: `npm run dev` (sobe API na 3000 + Vite na 5173 com proxy `/api`), ou usar o preview do harness com o config `dgs-web` (aponta pra porta 5173).
- Cadastro está **vazio** de propósito (nenhum município/médico/procedimento) — é o estado real de primeiro acesso, não precisa popular a menos que peçam.

**Backend** (`src/`):
- `config/env`, `lib/` (prisma, auth scrypt, phone E.164, whatsapp, templates, timezone, csv, http, errorReporting)
- `middleware/` (sessão, auth, rate limit no Postgres, errorHandler, rawBody)
- `modules/auth` — login com regeneração de sessão
- `modules/audit` — trilha de toda alteração manual
- `modules/catalog` — municípios, unidades, médicos, procedimentos, procedimento×médico com valores
- `modules/agendas` — escala do médico (âncora das listas complementares)
- `modules/extraction` — prompt, schema, chamada ao Claude, mapeador para rascunhos
- `modules/lists` — upload, extração assíncrona, edição na revisão, aprovação
- `modules/queue` — fila com throttle e teto diário da Meta
- `modules/whatsapp` — webhook (respostas, statuses de entrega, opt-out), idempotente por wamid
- `modules/closings` — checks 2 e 3 + `closings.alerts.ts` (módulo puro de inconsistências)
- `modules/indicators` — as 4 taxas + repasse/faturamento/margem, e export CSV
- `modules/team` — equipe (criar, redefinir senha, ativar/desativar, trocar a própria) e leitura da trilha de auditoria
- `modules/suggestions` — `suggestions.ts` (puro, testado) calcula overbooking pela taxa histórica; `suggestions.service.ts` busca o histórico em cascata (médico+procedimento → médico → município → global)
- `modules/queue/cadence.service` — lembrete D-1, reenvio pelo telefone alternativo e expurgo LGPD; tudo acionado pelo cron horário
- `modules/replies` — classificação por IA de resposta em texto livre ambígua (só entra quando `classifyReply()` puro devolve "unknown"); corte de confiança 0,7, abaixo disso fica "unknown" mesmo assim
- `modules/reports/daily-summary.service` — resumo do dia pro gestor (e-mail com a agenda de amanhã), cron próprio às 18h
- `modules/lists/list-report.ts` — geração do CSV do relatório de uma lista, reaproveitada pelo export manual e pelo e-mail automático ao concluir
- `lib/email.ts` — wrapper do Resend com stub em log quando falta `RESEND_API_KEY`
- Reposição de vagas: `GET /api/agendas/:id/open-slots` (+ `/export`) lista os horários que abriram (recusa/sem resposta/sem telefone); lista complementar (`isComplementary`) dispara com o template `VAGA_ABERTA` em vez de `CONFIRMACAO`
- `modules/whatsapp/whatsapp-account.service.ts` — credenciais do WhatsApp: prioriza a conta conectada via Embedded Signup (tabela `WhatsappAccount`, sempre no máximo uma linha) e cai pro `.env` (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`) só como fallback de sandbox/dev. `signup.routes.ts` expõe a troca do `code` do Embedded Signup por token de longa duração — ver aba WhatsApp em Configurações

**Frontend** (`web/src/`): login, shell, Listas, Revisão (tabela + arquivo lado a lado + sugestão de confirmações), Acompanhamento, Fechamento, Indicadores, Configurações (7 abas, incluindo WhatsApp/Embedded Signup), Equipe e auditoria, `StatusBand`, `ConfirmModal`, `FormModal`, `ui.tsx`.

**Nunca executado de verdade**: a chamada à API de extração e o envio real de WhatsApp — falta credencial. Os testes cobrem a lógica pura (telefone, classificação de resposta, mapeamento da extração, alertas de fechamento), não a integração.

**Fase 2 completa** conforme escopo do PLANO.md: lembrete D-1, reenvio por telefone alternativo, sugestão de confirmações, expurgo LGPD, classificação por IA de texto livre ambíguo, reposição de vagas via lista complementar, relatório automático por e-mail ao concluir a lista, e resumo diário para o gestor.

**Score de no-show por paciente: deliberadamente não implementado.** O dado não existe — o médico informa um total de atendidos por dia, não quem compareceu. Qualquer score seria aproximação apresentada como fato. A função pura `noShowScore` está pronta e testada em `modules/suggestions/suggestions.ts` para quando houver presença por paciente. Ver o comentário no fim de `suggestions.service.ts`.

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

## Pendências externas (bloqueiam ir pra produção — dev local já funciona sem elas)

1. Projeto Supabase dedicado de produção + trocar `DATABASE_URL`/`DIRECT_URL` no `.env` (hoje aponta pro Postgres local).
2. Número de WhatsApp Business + app na Meta (app dedicado `dgs-system`, **não** o `innovaIA` — esse é da barbearia), e os **templates submetidos para aprovação** (maior lead time do projeto) — `npm run templates` depois de ter `WHATSAPP_BUSINESS_ACCOUNT_ID` e um token com `whatsapp_business_management`.
   - Conectar a conta pelo sistema (Configurações → WhatsApp → Embedded Signup) em vez de configurar token/IDs à mão exige, no app `dgs-system`: análise aprovada (`whatsapp_business_management`, `business_management` — em andamento), ícone do app, URL de Política de Privacidade, e criar a "Configuration" do Embedded Signup (WhatsApp → Configuração da API) pra gerar `WHATSAPP_APP_ID`/`WHATSAPP_SIGNUP_CONFIG_ID`.
3. Chave da API Anthropic (`ANTHROPIC_API_KEY`) para a extração e a classificação de respostas ambíguas.
4. Chave do Resend (`RESEND_API_KEY`) para relatório automático por e-mail e resumo diário.
5. PDFs reais de 2–3 prefeituras para calibrar o prompt de extração (só fotos até agora) — `npm run extrair -- caminho/do/arquivo.pdf`.
6. Valores de `doctor_fee` e `city_rate` por procedimento.
7. Plano **Pro** da Vercel pro cron horário da fila funcionar em produção (Hobby só roda cron 1x/dia).
