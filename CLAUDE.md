# Contexto do projeto — sistema-dgs

Leia isto no início de qualquer sessão nova. O desenho completo do produto está no [PLANO.md](PLANO.md) e os textos de WhatsApp em [TEMPLATES-WHATSAPP.md](TEMPLATES-WHATSAPP.md) — aqui ficam o estado atual e as convenções operacionais.

## O que é

Ferramenta **interna** da DGS (D'Artibale Gestão em Saúde), empresa que intermedia secretarias municipais de saúde e médicos contratados em SC. Recebe listas diárias de agendamento (PDF nativo gerado pelo SISREG ou CELK — nunca foto), extrai localmente sem IA, dispara confirmação por WhatsApp com botões Sim/Não e concilia o atendimento em três checagens.

Não é multi-tenant, não tem cobrança e não tem perfis de acesso: **perfil único**, todo mundo da equipe pode tudo. O controle vem da tabela `audit_logs`, não de permissões — decisão explícita do usuário.

- Repo: [github.com/iomeswesley/dgs-sistema](https://github.com/iomeswesley/dgs-sistema) (privado), branch `master`.
- Deploy: **publicado em produção desde 2026-08-14/15** — `https://sistema-dgs.vercel.app` (projeto Vercel `innova-ia/sistema-dgs`). `vercel.json` + `api/index.js`.
- Banco de **produção**: Postgres/Supabase (`aws-0-sa-east-1.pooler.supabase.com`), projeto `koplspjaqazgsvcaspmp`. **Em uso de verdade agora** — deixou de ser só referência em `.env.production`. O projeto Supabase é free tier e **pausa sozinho por inatividade** (aconteceu em 2026-08-14: precisou reativar manualmente no dashboard antes de `prisma migrate deploy` funcionar de novo — se der erro `tenant/user ... not found`, é isso, não é bug).
- Banco de **dev local**: Postgres 17 em container Docker (`docker-compose.yml` na raiz, serviço `postgres`, container `dgs-postgres`), banco `sistema_dgs`, usuário `postgres`, senha `dgs_local_dev`, porta 5432.
- **⚠️ O `.env` ativo desta máquina está apontando pro banco de PRODUÇÃO desde o deploy de 2026-08-14/15**, não mais pro Docker local — troca deliberada, mantida assim por decisão do usuário ("sem problemas deixar produção pro Vercel direto"). Qualquer script rodado localmente (seed, reset de senha, `npx prisma ...`) afeta o banco real. Pra voltar a apontar pro Docker local, trocar `DATABASE_URL`/`DIRECT_URL` de volta — só fazer isso se o usuário pedir.

## Estado atual (2026-08-15)

**Fase 1 e Fase 2 do PLANO.md implementadas e em produção.** Primeiro deploy real feito em 2026-08-14. Validado de ponta a ponta contra produção, com dado real:

- Login, navegação, upload/preview/revisão/aprovação/disparo — tudo testado contra o banco e o WhatsApp de produção.
- **WhatsApp 100% validado com pessoas reais**: envio → entrega → clique no botão → webhook → classificação da resposta, tudo confirmado (ver "WhatsApp em produção" abaixo).
- **Extração testada com 3 PDFs reais de 2 prefeituras** (Camboriú/CELK ×2, Pomerode/SISREG ×1) — os três reconhecidos e extraídos com sucesso (23/23, 30/30, 50/50 pacientes). Só essas 2 prefeituras têm calibração confirmada; qualquer prefeitura nova precisa de um PDF de exemplo pra confirmar antes (`npm run extrair -- caminho/do/arquivo.pdf`) — ver pendência sobre isso mais abaixo.
- **Disparo em massa real testado de ponta a ponta** (Lista → Revisão → Aprovar → Disparar, não só o atalho "Enviar teste") com 3 números reais de pessoas da equipe — confirmações chegaram, respostas de botão (Sim/Não) voltaram certinho pelo webhook.

**Escopo reduzido por decisão do usuário em 2026-08-09**: o módulo financeiro (repasse ao médico, faturamento, margem — `doctor_fee`/`city_rate`) não entra nesta fase do projeto. O produto agora é só agendamento + confirmação de comparecimento via WhatsApp; ver PLANO.md.

**Cadastro de produção está vazio de propósito** (checado e limpo em 2026-08-15 — havia um resquício de teste de 2026-07-27 esquecido lá, removido). Precisa popular com município/unidade/médico/procedimento reais antes do cliente operar pra valer.

### Pendências abertas
Nenhuma aberta desta rodada — as 5 pendências de 2026-08-15 foram todas resolvidas (ver abaixo). Próxima pendência de verdade é popular o cadastro de produção antes do cliente operar (ver "Estado atual" acima).

### Resolvido em 2026-08-15
- **Excluir lista**: `DELETE /api/lists/:id` (`deleteList()` em `lists.service.ts`) apaga lista + agendamentos + fila de mensagens (cascade no schema). Bloqueia com 409 se já DISPARADA/CONCLUIDA — WhatsApp real já foi pro paciente, nesse caso só dá pra remover linha por linha. Botão em cada card de Listas e nas ações da Revisão, com `ConfirmModal`.
- **Município não pré-preenchia no preview do upload**: não era bug de lógica — o `/api/lists/preview` estava caindo por causa do crash de extração em produção (`DOMMatrix`/worker, já corrigidos em `2ff37fa`/`1bb0bc1`), e o frontend engolia o erro em silêncio. Testado com PDF real de produção (Camboriú): município/unidade/agenda batem certinho. `Listas.tsx` agora mostra erro visível quando o preview falha, em vez de falhar calado.
- **Checagem de unidade/endereço antes de aprovar e disparar**: `checkUnit()` (`lists.service.ts`) compara a unidade da agenda vinculada (cadastro) com o texto que a extração leu no PDF, exposta como `unitCheck` em `GET /api/lists/:id`. `approveList()` **bloqueia no backend** (409) se houver problema (sem agenda, agenda sem unidade, unidade sem endereço, ou PDF×cadastro não batendo) e a equipe não tiver marcado `confirmUnitMismatch`. Revisão mostra o comparativo "PDF diz / Cadastro diz" com checkbox obrigatório antes de Aprovar/Disparar. Tela de envio de lista agora mostra o endereço que vai pra mensagem assim que uma agenda é selecionada, com aviso se não bate com o que o PDF trouxe.
- **Relatório automático por e-mail + contato de secretaria removidos de vez**: `contactName`/`contactPhone`/`contactEmail` tirados do schema `Municipality` (migration `20260815020000`, aplicada em produção — campos estavam vazios, sem dado real perdido). `POST /api/lists/:id/conclude` só marca `CONCLUIDA` agora; relatório continua disponível só por download manual ("Exportar").
- **Cron diário ativado (só lembrete D-1) + resumo do gestor removido**: decisão do usuário — o único envio automático que interessa é o lembrete de véspera pro paciente; não existe mais resumo diário por e-mail pro gestor (`modules/reports/daily-summary.service.ts` apagado, rota `/api/cron/daily-summary` removida). `lib/email.ts`/Resend ficaram sem nenhum uso depois disso (mantidos por enquanto, ninguém pediu pra tirar a dependência). `vercel.json` ganhou `crons: [{ path: "/api/cron/queue", schedule: "0 12 * * *" }]` — 9h de Brasília, 1x/dia, cabe no plano **Hobby** (não precisa de Pro). O endpoint virou `GET` (Vercel Cron só invoca por GET, nunca POST — antes como POST o cron nunca teria disparado de verdade nem se `vercel.json` tivesse `crons` configurado). Esse mesmo cron agora faz um `SELECT 1` no Supabase antes de tudo, como keep-alive contra a pausa por inatividade do free tier.
- **Cadastro de Unidade juntado ao de Município**: aba "Unidades" removida de Configurações; cada card de município na aba Municípios já mostra as unidades dele com "Nova unidade" ali dentro (sem select de município, sem trocar de aba). `GET /api/catalog/units` continua existindo, só perdeu a tela própria.

## Ambiente local (já configurado nesta máquina)

**Histórico rápido, pra não repetir o erro**: entre 2026-07-25 e 2026-07-27 o `.env` desta máquina apontou sem querer pro Supabase de produção (`ANTHROPIC_API_KEY`/`WHATSAPP_ACCESS_TOKEN` já eram reais também) — cada request cruzava a rede até São Paulo e a Revisão de lista chegou a levar 7-9s pra carregar. Corrigido em 2026-07-27: dev volta a usar Postgres local via Docker, rápido (as mesmas rotas caíram pra 15-120ms).

- **Banco ativo**: Postgres local em Docker. Subir com `docker compose up -d` (usa o `docker-compose.yml` da raiz); esperar ficar `healthy` com `docker inspect --format='{{.State.Health.Status}}' dgs-postgres`. Migrations com `npx prisma migrate deploy` (nunca `migrate dev` — ver "Convenções operacionais"). Primeiro usuário com `npm run seed -- "Nome" email@dgs.local`.
- **`.env.production` guarda a string de conexão real do Supabase** (e as demais chaves) pra quando o projeto for de fato publicado — não é carregado automaticamente por nada, é só referência. **Nunca copiar esses valores de volta pro `.env` ativo sem confirmar explicitamente com o usuário antes** — foi exatamente essa troca sem querer que causou o incidente de 2026-07-25/27 (rodei `npm run seed` achando que era local e criei usuário em produção).
- `ANTHROPIC_API_KEY` e `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` no `.env` ativo **continuam reais** (não dependem do banco) — extração e envio de WhatsApp funcionam de verdade mesmo com o banco local. **"Disparar confirmações" e a cadência do dia mandam WhatsApp de verdade** mesmo em dev — pra testar sem risco, usar o card "Enviar teste" em Configurações → WhatsApp (`POST /api/whatsapp/signup/test-send`), que nunca consulta paciente/agendamento no banco.
- `wesley@dgs.local` era o usuário de equipe documentado aqui antes — ele existe no banco de **produção** (Supabase), não no Postgres local novo. No banco local atual não há usuário até alguém rodar `npm run seed`.
- **Corrigido**: `npm run dev:api` força `PORT=3000` via `cross-env`, porque o harness de preview injeta `PORT=5173` (a porta do Vite) no ambiente e o `--env-file` do Node não sobrescreve variável já existente — sem o `cross-env` a API tentava subir na mesma porta do Vite e o login falhava com 502. Não reverter esse script.
- Pra rodar: `npm run dev` (sobe API na 3000 + Vite na 5173 com proxy `/api`), ou usar o preview do harness com o config `dgs-web` (aponta pra porta 5173). Trocar algo no `.env` exige reiniciar o processo da API (`tsx watch` só recarrega o `--env-file` quando o processo reinicia — tocar em `src/server.ts` força o restart sem precisar matar o terminal).
- Cadastro está **vazio** de propósito (nenhum município/médico/procedimento) — é o estado real de primeiro acesso local, não precisa popular a menos que peçam.

**Backend** (`src/`):
- `config/env`, `lib/` (prisma, auth scrypt, phone E.164, whatsapp, templates, timezone, csv, http, errorReporting)
- `middleware/` (sessão, auth, rate limit no Postgres, errorHandler, rawBody)
- `modules/auth` — login com regeneração de sessão
- `modules/audit` — trilha de toda alteração manual
- `modules/catalog` — municípios, unidades, médicos, procedimentos, procedimento×médico com valores
- `modules/agendas` — escala do médico (âncora das listas complementares)
- `modules/extraction` — parsers locais (SISREG/CELK, sem IA), schema, mapeador para rascunhos — ver "Extração de listas: local, sem IA"
- `modules/lists` — preview (sugere município/agenda antes de criar a lista), upload, extração assíncrona, edição na revisão, aprovação
- `modules/queue` — fila com throttle e teto diário da Meta
- `modules/whatsapp` — webhook (respostas, statuses de entrega, opt-out), idempotente por wamid
- `modules/closings` — checks 2 e 3 + `closings.alerts.ts` (módulo puro de inconsistências)
- `modules/indicators` — as 4 taxas + repasse/faturamento/margem, e export CSV. Núcleo puro em `indicators.ts` (testado, `indicators.test.ts`), `indicators.service.ts` só busca no banco e chama ele — mesmo padrão de `suggestions`/`closings`. **Repasse/faturamento/margem continuam calculados, mas a UI esconde os três** (🚧 "em desenvolvimento" em Indicadores e em Configurações → Procedimentos por médico) — fora de escopo desde 2026-08-09, decisão reforçada em 2026-08-15.
- `modules/team` — equipe (criar, redefinir senha, ativar/desativar, trocar a própria) e leitura da trilha de auditoria
- `modules/suggestions` — `suggestions.ts` (puro, testado) calcula overbooking pela taxa histórica; `suggestions.service.ts` busca o histórico em cascata (médico+procedimento → médico → município → global)
- `modules/queue/cadence.service` — lembrete D-1, reenvio pelo telefone alternativo e expurgo LGPD; acionado pelo cron diário (`GET /api/cron/queue`, 9h Brasília — ver `vercel.json`) ou na mão por `POST /api/queue/run-cadence`
- `modules/replies` — classificação por IA de resposta em texto livre ambígua (só entra quando `classifyReply()` puro devolve "unknown"); corte de confiança 0,7, abaixo disso fica "unknown" mesmo assim
- `modules/lists/list-report.ts` — geração do CSV do relatório de uma lista, reaproveitada pelo export manual (não tem mais e-mail automático nenhum)
- `lib/email.ts` — wrapper do Resend; sem uso nenhum no código desde que as duas features de e-mail (relatório à secretaria e resumo ao gestor) foram removidas — mantido só porque ninguém pediu pra tirar a dependência
- Reposição de vagas: `GET /api/agendas/:id/open-slots` (+ `/export`) lista os horários que abriram (recusa/sem resposta/sem telefone); lista complementar (`isComplementary`) dispara com o template `VAGA_ABERTA` em vez de `CONFIRMACAO`
- `modules/whatsapp/whatsapp-account.service.ts` — credenciais do WhatsApp: prioriza a conta conectada via Embedded Signup (tabela `WhatsappAccount`, sempre no máximo uma linha) e cai pro `.env` (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`) só como fallback de sandbox/dev. `signup.routes.ts` expõe a troca do `code` do Embedded Signup por token de longa duração — ver aba WhatsApp em Configurações

**Frontend** (`web/src/`): login, shell, Listas, Revisão (tabela + arquivo lado a lado + sugestão de confirmações), Acompanhamento, Fechamento, Indicadores, Configurações (7 abas, incluindo WhatsApp/Embedded Signup), Equipe e auditoria, `StatusBand`, `ConfirmModal`, `FormModal`, `ui.tsx`.

**Nunca executado de verdade**: o envio real de WhatsApp pro paciente (falta confirmar entrega — usar o card "Enviar teste") e o fluxo novo de upload/preview/popup de agenda no navegador (ver "Estado atual"). A extração em si **já foi validada de verdade** contra 4 PDFs reais/exemplo — não depende mais de credencial nenhuma. Os testes cobrem a lógica pura (telefone, classificação de resposta, mapeamento da extração, alertas de fechamento, os dois parsers de extração, casamento de nome pro preview), não a integração de rede/banco.

**Fase 2 majoritariamente completa** conforme escopo do PLANO.md: lembrete D-1 (agora automático via cron diário), reenvio por telefone alternativo, sugestão de confirmações, expurgo LGPD, classificação por IA de texto livre ambíguo, reposição de vagas via lista complementar. Relatório automático por e-mail e resumo diário pro gestor foram removidos de escopo por decisão do usuário (2026-08-15) — deixaram de fazer parte do produto.

**Score de no-show por paciente: deliberadamente não implementado.** O dado não existe — o médico informa um total de atendidos por dia, não quem compareceu. Qualquer score seria aproximação apresentada como fato. A função pura `noShowScore` está pronta e testada em `modules/suggestions/suggestions.ts` para quando houver presença por paciente. Ver o comentário no fim de `suggestions.service.ts`.

## Convenções de código

- **Antes de qualquer commit**: `npm run typecheck` (server + web) e `npm test` limpos.
- **`git push` e deploy na Vercel (`vercel --prod`) só quando o usuário pedir explicitamente** (decisão de 2026-07-26, substitui a instrução anterior de "push sem perguntar"). Pode continuar commitando local normalmente — só a subida pro GitHub/produção fica pausada. Ações destrutivas continuam exigindo confirmação.
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
- **Minimização de dados diante de pedido de autoridade pública ou do titular (LGPD art. 18)**: nunca abrir acesso à base inteira. Usar `npx tsx --env-file=.env scripts/exportar-dados-paciente.ts --cns=... [--incluir-mensagens]` — traz só o essencial de UM paciente (nome, telefones, agendamentos); conteúdo de mensagem e nota interna da equipe são opt-in, não vêm por padrão. Confirmar legitimidade do pedido com o jurídico antes de repassar qualquer coisa.
- Manter este arquivo e o PLANO.md atualizados a cada mudança relevante.

## Extração de listas: local, sem IA (2026-08-06)

A extração **não chama mais nenhuma API de IA**. Decisão de 2026-08-05, implementada em 2026-08-06: só entra PDF nativo (SISREG ou CELK) — a prefeitura não manda mais foto — e a leitura é um parser determinístico local (`pdf-parse` pra texto + regex), de graça e instantâneo (~0,5s contra ~30-120s da IA antes).

- `src/modules/extraction/parsers/detect.ts` — reconhece o formato pela assinatura no cabeçalho/rodapé do PDF (`SISREG`, `CELK` ou `OUTRO`).
- `src/modules/extraction/parsers/celk.ts` — CELK exporta uma linha de texto por paciente, direto: regex simples resolve.
- `src/modules/extraction/parsers/sisreg.ts` — SISREG quebra cada célula em uma linha separada, sem alinhamento de coluna, e a fragmentação **varia dentro do mesmo arquivo** (nome de campo às vezes sozinho na linha, às vezes colado ao campo seguinte por tab — ex.: código de solicitação com o dia da semana). O parser não confia em posição de linha: junta tudo do registro numa string e vai consumindo por **padrão de campo**, na ordem: código de solicitação → dia da semana → data → hora → CNS (15 dígitos, tolera 1 espaço perdido no meio) → nome → nascimento (idem, tolera quebra no último dígito do ano) → idade → origem (`CIDADE - UF`) → telefone(s) (tolera quebra logo após o hífen) → unidade solicitante → vaga (`1ª VEZ`/`RETORNO`) → CID-10 (lido só pra saber onde o registro termina — **nunca entra no resultado**, LGPD). Testado e validado campo a campo contra os 4 PDFs reais/exemplo disponíveis (100% de recall: 14/14, 50/50, 30/30, 23/23 pacientes, batendo com a contagem declarada no rodapé de cada relatório).
- `src/modules/extraction/parsers/shared.ts` — telefone (formatado e cru) e datas, compartilhado pelos dois parsers.
- `extraction.service.ts` mantém a mesma assinatura de antes (`extractList(file, mimeType) -> { result, usage }`) — só troca o motor por dentro. `usage` fica zerado (não há tokens, mas o campo continua existindo pra não quebrar `scripts/extrair.ts`). `extractionConfigured` agora é sempre `true` (não depende de chave nenhuma).
- Upload só aceita `application/pdf` agora (`ACCEPTED_TYPES` em `lists.routes.ts`, `accept=".pdf"` em `web/src/pages/Listas.tsx`) — imagem foi removida do fluxo inteiro.
- Formato `OUTRO` (não reconhecido) não trava a lista: ela cai em revisão vazia, com aviso pedindo preenchimento manual — não há mais fallback pra IA reconhecer.
- `extraction.prompt.ts` foi apagado (só existia pro prompt da IA). `@anthropic-ai/sdk` continua no projeto — ainda é usado por `modules/replies` (classificação de resposta ambígua), feature separada que não foi tocada.
- `pdf-parse` (`^2.4.5`) é dependência real agora, não só de teste — usa a API `PDFParse` (não a função antiga `pdf(buffer)` da v1).

## Upload de lista sugere município/agenda sozinho (2026-08-06)

Como a extração agora é local e instantânea, dá pra ler o cabeçalho do PDF **antes** de criar a lista e pré-preencher o formulário de upload — não precisa mais escolher tudo na mão toda vez.

- `POST /api/lists/preview` (`src/modules/lists/lists.preview.ts`) — recebe o arquivo, roda `extractList` (sem persistir nada) e tenta casar o que leu com o cadastro: município (`exact`, só igual — nunca por conter, ver abaixo), unidade/médico/procedimento (fuzzy, por conter — nomes costumam vir encurtados), e uma agenda já existente pra município+médico+data+unidade. Só sugere quando o candidato é único; ambíguo ou sem match fica `null` e a equipe escolhe na mão, como antes.
- `src/lib/text-match.ts` — `exactNameMatch` (só igual) vs `namesMatch` (igual ou contém). **Município usa `exact` sempre** — nunca fuzzy: "Camboriú" bate por conter dentro de "Balneário Camboriú" (município vizinho e diferente em SC), e escolher errado manda o relatório final pro contato da prefeitura errada. Unidade/médico/procedimento usam fuzzy — é normal o mesmo lugar aparecer encurtado ("SAIS" vs "SAIS SERVICO DE ATENDIMENTO INTEGRAL A SAUDE"). Achado testando: sem essa separação, o teste automatizado pegou o próprio bug do Camboriú/Balneário Camboriú.
- `web/src/pages/Listas.tsx` — escolher o arquivo já chama o preview e pré-seleciona Município e, quando existir, a Agenda. Se município e médico foram reconhecidos mas não existe agenda pra essa data, abre um popup (`FormModal`) pré-preenchido pedindo pra completar (capacidade nunca vem do PDF) e confirmar — só depois a lista é criada de fato, com `POST /api/agendas` rodando por trás se for preciso. O upload deixou de disparar sozinho ao escolher o arquivo (como era antes) — agora tem um botão "Enviar lista" explícito, porque o passo de preview/confirmação precisa de um momento antes de subir pra valer.
- **Achado no caminho, corrigido**: a tela "Nova agenda" em Configurações nunca teve campo de Unidade — o backend aceita `unitId`, mas o formulário não mandava. Toda Agenda criada por ali ficava com `unitId = null`, o que quebra a mensagem de WhatsApp (sem unidade vinculada, sai só o nome do município — é o aviso que já existe na revisão). Corrigido: campo Unidade adicionado ao formulário e à listagem.
- **Popup de cadastro de município (2026-08-09)**: se o preview leu um nome de município que não bate com nada cadastrado, abre um `FormModal` pedindo pra confirmar/cadastrar (nome pré-preenchido em Title Case a partir do que veio em CAIXA ALTA no PDF — `toTitleCase()` local em `Listas.tsx`, nunca inventa acento que o PDF não tinha). Ao cadastrar (`POST /api/catalog/municipalities`), encadeia automaticamente pro popup de agenda se médico+data também foram reconhecidos e não existe agenda pra esse município ainda (o preview original não checou agenda pra um município que nem existia — a checagem é refeita no cliente contra as agendas já carregadas). Verificado de ponta a ponta no navegador em 2026-08-09.

## WhatsApp em produção (2026-08-14/15)

- **Número ativo hoje**: `+55 47 8865-6379`, WABA "innova agendamentos" (nome de exibição ainda errado de propósito — trocar exige revisão da Meta, não é urgente). Conectado via fallback do `.env` (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_BUSINESS_ACCOUNT_ID`), não pela tela ainda.
- **`WHATSAPP_APP_ID` correto é `1681012396346095`** (16 dígitos) — teve um erro de transcrição pra `16810012396346095` (17 dígitos, um "0" a mais no meio) que quebrou a configuração de webhook por um bom tempo até ser achado. Se `/api/whatsapp/signup/config` ou qualquer chamada de app-access-token (`{app_id}|{app_secret}`) der "Invalid application ID", checar esse valor primeiro.
- **Billing da WABA precisa estar configurado** — sem moeda/forma de pagamento cadastrada, todo envio falha com erro 131042 "Business eligibility payment issue" (aceita a chamada, devolve `wamid`, mas o webhook de status volta `failed`). Configura em `business.facebook.com/billing_hub/accounts/details/?business_id=981536728049005&asset_id=<waba_id>&wizard_name=CHANGE_COUNTRY_CURRENCY&account_type=whatsapp-business-account`.
- **Webhook**: `callback_url` = `https://sistema-dgs.vercel.app/api/whatsapp/webhook`, campo `messages` assinado. A tela de "Webhooks" nem sempre aparece no painel da Meta pra apps configurados como Tech Provider (via Login do Facebook para Empresas) — nesse caso, configura direto pela Graph API (`POST /{app_id}/subscriptions` com `access_token={app_id}|{app_secret}`, `object=whatsapp_business_account`, `callback_url`, `verify_token`, `fields=messages`) em vez de procurar um campo na UI que pode não existir.
- **Failover manual entre números** (2026-08-15): `WhatsappAccount` agora aceita mais de uma linha, com `active` decidindo qual credencial o sistema usa (`getActiveCredentials()` em `whatsapp-account.service.ts`). Configurações → WhatsApp lista todas as contas conectadas via Embedded Signup, com botão "Usar este número" (troca ativa), "Remover" (com `ConfirmModal`) e "editar" (apelido interno, campo `label`, separado do `businessName` que vem da Meta). **A lista de contas e o botão de conectar precisam aparecer mesmo quando `status.source === "env"`** (é o estado atual de produção) — já corrigido depois de um bug em que ficavam escondidos nesse caso.
- **Coexistência (número que já tem WhatsApp Business App instalado, ex.: o da colega da equipe) — corrigido um mal-entendido em 2026-08-16**: achamos que precisava abrir um link só no celular (`business.facebook.com/messaging/whatsapp/onboard/?app_id=...&config_id=935268162166199`); os docs da Meta ([onboarding-business-app-users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)) mostram que roda pelo **mesmo popup do Embedded Signup no navegador** — a Meta manda um código pro WhatsApp Business App do celular, a pessoa confirma lá e cola o código de volta no popup. Achamos e corrigimos um bug real nisso: a Meta manda o evento `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (não `FINISH`) ao concluir, e o listener só reconhecia `FINISH` — o fluxo terminava certinho do lado da Meta e o app mostrava "login cancelado" mesmo assim. Configurações → WhatsApp agora tem dois botões: "Conectar WhatsApp (número novo/limpo)" e "Conectar número que já usa WhatsApp Business App" — os dois caem na mesma `WHATSAPP_SIGNUP_CONFIG_ID` hoje (não existe uma configuração de coexistência separada de verdade ainda; `WHATSAPP_SIGNUP_CONFIG_ID_COEXISTENCE` fica pronto se a equipe criar uma dedicada no WhatsApp Manager). **Ainda não testado de ponta a ponta com um número real** — o bug foi achado por inspeção/documentação, não por teste ao vivo. Falta também subscrever o app aos campos de webhook extras que coexistência usa (`history`, `smb_app_state_sync`, `smb_message_echoes`, além de `messages`) — é config na Meta via `POST /{app_id}/subscriptions`, não código.
- **Cadência dispara globalmente**: `POST /api/queue/run-cadence` e `POST /api/lists/:id/dispatch` chamam `processQueue()`, que processa **todo** `MessageJob` `PENDENTE` do sistema, não só os da lista que você está olhando. Descoberto em 2026-08-15 quando aprovar uma lista de teste disparou também 14 jobs de uma lista antiga esquecida desde 2026-07-27.

## Extração de PDF na Vercel: dois bugs sérios já resolvidos (2026-08-15)

A extração funcionava perfeita local (Windows) mas quebrava em produção (Vercel/Linux) — dois problemas distintos, mesma raiz (dependências nativas do `pdf-parse`/`pdfjs-dist` que o rastreador de arquivos da Vercel não inclui sozinho no bundle serverless):

1. **`ReferenceError: DOMMatrix is not defined`** — `pdfjs-dist` tem `const SCALE_MATRIX = new DOMMatrix();` incondicional no topo do módulo de canvas, só usado pra *renderizar* página (nunca fazemos isso, só lemos texto). Ele tenta carregar `@napi-rs/canvas` pra conseguir esse polyfill, e se o binário nativo da plataforma não estiver disponível, não cai num fallback — derruba o processo inteiro. **Resolvido** definindo um "boneco" de `DOMMatrix`/`ImageData`/`Path2D` em `globalThis` antes de importar `pdf-parse` (`extraction.service.ts`) — o `pdfjs-dist` só tenta carregar o canvas de verdade quando esses globals ainda não existem, então o boneco evita a importação nativa por completo.
2. **`Cannot find module '.../pdfjs-dist/legacy/build/pdf.worker.mjs'`** — depois do fix acima, apareceu esse outro: o worker do `pdfjs-dist` é carregado dinamicamente (fora do alcance do rastreador estático de arquivos da Vercel), então não ia sozinho no bundle da function. **Resolvido** incluindo o pacote inteiro via `includeFiles` no `vercel.json` (`"{dist,dist-web,node_modules/pdfjs-dist}/**"`).

**Se algo parecido aparecer de novo** (outro `Cannot find module` ou `ReferenceError` de uma API de browser dentro de `pdf-parse`/`pdfjs-dist`): é quase sempre essa mesma categoria de problema — dependência nativa ou asset carregado dinamicamente que o `@vercel/nft` não rastreia. Primeiro tentar rodar `vercel --prod --force` (ignora cache de build, que já mascarou isso uma vez) antes de assumir que é bug novo.

## Notas técnicas que não são óbvias

- **A extração de listas não usa mais IA** (ver seção acima) — histórico: chegou a rodar com `claude-opus-5`, depois `claude-haiku-4-5-20251001`, antes de virar parser local em 2026-08-06. `@anthropic-ai/sdk` continua no projeto só por causa de `modules/replies` (classificação de resposta ambígua) — regra central lá: campo ilegível vira `null`/`"unknown"` com confiança baixa, nunca um chute.
- **`react-router-dom` fica na versão mais recente (7.18.x) mesmo com um aviso do `npm audit`.** O aviso é GHSA-2w69-qvjg-hvjx (CSRF em **RSC mode**), que não se aplica: usamos SPA com `BrowserRouter`, sem React Server Components nem server actions. A "correção" que o npm sugere é descer para 7.11.0, que é afetada por **13 outros** avisos. Não descer de versão.
- `@theme inline` no `index.css` mapeia os tokens do Tailwind para variáveis CSS próprias, que trocam no seletor `.dark`. Por isso as utilidades (`bg-sheet`, `text-ink`…) acompanham o tema sozinhas.
- O build do Vite sai em `dist-web/` e o Express serve dali em produção (`WEB_DIST` em `src/app.ts`); em dev são dois processos (`npm run dev` sobe os dois, com proxy `/api` do Vite para a porta 3000).
- `api/index.js` importa de `dist/`, não do TypeScript fonte — os aliases `@/...` já foram reescritos pelo `tsc-alias` no build.
- O webhook precisa tratar `statuses` (entrega/falha), diferente da barbearia-saas que os ignora: telefone errado na lista da prefeitura é rotina e vira indicador de qualidade devolvido à secretaria.

## Pendências (a maioria resolvida em 2026-08-14/15 — ver "Estado atual" no topo pro que falta de verdade)

Tudo abaixo já foi feito. Fica só como histórico de decisão — pra pendências reais em aberto, ver "Pendências abertas" no topo do arquivo.

1. ~~Projeto Supabase dedicado de produção~~ — **feito e em uso** desde 2026-08-14 (não é mais só referência em `.env.production` — é o banco ativo).
2. ~~Número de WhatsApp Business + token, Embedded Signup, templates~~ — **feito**: WABA própria ("innova agendamentos"), billing configurado, templates aprovados, webhook ativo, validado com pessoas reais. Ver "WhatsApp em produção" acima pros detalhes/armadilhas.
3. ~~Chave da API Anthropic para extração~~ — não é mais pendência (extração local desde 2026-08-06).
4. ~~Chave do Resend~~ — decisão do usuário: manter sem Resend por enquanto. **Decisão de 2026-08-15: as duas features de e-mail (relatório à secretaria e resumo ao gestor) foram removidas do código de vez** — não é mais pendência, não tem mais nada esperando o Resend.
5. ~~PDFs reais pra calibrar extração~~ — feito, agora com 3 PDFs de 2 prefeituras confirmados contra produção (Camboriú/CELK, Pomerode/SISREG).
6. ~~`doctor_fee`/`city_rate`~~ — fora de escopo (módulo financeiro não entra nessa fase).
7. ~~Cron/Plano Pro da Vercel~~ — **resolvido em 2026-08-15 sem precisar de Pro**: `vercel.json` roda `/api/cron/queue` 1x/dia (cabe no Hobby), automatizando só o lembrete D-1 (e o resto da cadência que já andava junto: reenvio, fechamento de vencido, expurgo LGPD).
8. ~~Hospedagem~~ — Vercel, publicado, `DATABASE_URL` trocada pra produção, `git push` + `vercel --prod` já rodados.
