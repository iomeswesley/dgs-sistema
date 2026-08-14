# Contexto do projeto — sistema-dgs

Leia isto no início de qualquer sessão nova. O desenho completo do produto está no [PLANO.md](PLANO.md) e os textos de WhatsApp em [TEMPLATES-WHATSAPP.md](TEMPLATES-WHATSAPP.md) — aqui ficam o estado atual e as convenções operacionais.

## O que é

Ferramenta **interna** da DGS (D'Artibale Gestão em Saúde), empresa que intermedia secretarias municipais de saúde e médicos contratados em SC. Recebe listas diárias de agendamento (PDF nativo gerado pelo SISREG ou CELK — nunca foto), extrai localmente sem IA, dispara confirmação por WhatsApp com botões Sim/Não e concilia o atendimento em três checagens.

Não é multi-tenant, não tem cobrança e não tem perfis de acesso: **perfil único**, todo mundo da equipe pode tudo. O controle vem da tabela `audit_logs`, não de permissões — decisão explícita do usuário.

- Repo: [github.com/iomeswesley/dgs-sistema](https://github.com/iomeswesley/dgs-sistema) (privado), branch `master`.
- Deploy: previsto para Vercel (`vercel.json` + `api/index.js` já prontos). Ainda não publicado.
- Banco de **produção**: Postgres/Supabase, projeto dedicado (`aws-0-sa-east-1.pooler.supabase.com`), já criado. **Guardado só em `.env.production`** (git-ignorado, não versionado) — não é o que o `.env` ativo usa no dia a dia. Ver "Ambiente local" abaixo.
- Banco de **dev local**: Postgres 17 em container Docker (`docker-compose.yml` na raiz, serviço `postgres`, container `dgs-postgres`), banco `sistema_dgs`, usuário `postgres`, senha `dgs_local_dev`, porta 5432. É o que o `.env` ativo usa por padrão. (O antigo texto aqui descrevia Postgres via winget/serviço Windows — era o ambiente do irmão do usuário rodando o projeto no Windows dele, não esta máquina. Neste Mac não havia Postgres nenhum instalado até 2026-07-27.)

## Estado atual (2026-08-09)

**Fase 1 e Fase 2 do PLANO.md implementadas por inteiro.** Diferente do que este arquivo dizia até 2026-07-27, as credenciais reais de produção (Supabase, Anthropic, WhatsApp) **já estão ligadas** — ver [INSTALACAO.md](INSTALACAO.md) e "Ambiente local" abaixo. O fluxo já foi **validado rodando de verdade**: login funcionando com sessão real, navegação testada no navegador contra o banco de produção.

Validado: typecheck (server + web), 96 testes e build limpos; login e navegação conferidos no navegador em 2026-07-27. **Fluxo completo de upload/preview/popup de município/popup de agenda verificado de ponta a ponta no navegador em 2026-08-09** (login local, upload real do PDF de exemplo, ambos os popups em cascata, dado de teste limpo depois — ver "Upload de lista sugere município/agenda sozinho" abaixo). Falta só confirmar se o disparo de WhatsApp chega mesmo no paciente (o card "Enviar teste" em Configurações → WhatsApp foi feito pra isso, e falta esclarecer se o número conectado é de produção ou o "Test Number" da Meta — ver pendência 2).

**Escopo reduzido por decisão do usuário em 2026-08-09**: o módulo financeiro (repasse ao médico, faturamento, margem — `doctor_fee`/`city_rate`) não entra nesta fase do projeto. O produto agora é só agendamento + confirmação de comparecimento via WhatsApp; ver PLANO.md.

## Ambiente local (já configurado nesta máquina)

**Histórico rápido, pra não repetir o erro**: entre 2026-07-25 e 2026-07-27 o `.env` desta máquina apontou sem querer pro Supabase de produção (`ANTHROPIC_API_KEY`/`WHATSAPP_ACCESS_TOKEN` já eram reais também) — cada request cruzava a rede até São Paulo e a Revisão de lista chegou a levar 7-9s pra carregar. Corrigido em 2026-07-27: dev volta a usar Postgres local via Docker, rápido (as mesmas rotas caíram pra 15-120ms).

- **Banco ativo**: Postgres local em Docker. Subir com `docker compose up -d` (usa o `docker-compose.yml` da raiz); esperar ficar `healthy` com `docker inspect --format='{{.State.Health.Status}}' dgs-postgres`. Migrations com `npx prisma migrate deploy` (nunca `migrate dev` — ver "Convenções operacionais"). Primeiro usuário com `npm run seed -- "Nome" email@dgs.local`.
- **`.env.production` guarda a string de conexão real do Supabase** (e as demais chaves) pra quando o projeto for de fato publicado — não é carregado automaticamente por nada, é só referência. **Nunca copiar esses valores de volta pro `.env` ativo sem confirmar explicitamente com o usuário antes** — foi exatamente essa troca sem querer que causou o incidente de 2026-07-25/27 (rodei `npm run seed` achando que era local e criei usuário em produção).
- `ANTHROPIC_API_KEY` e `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` no `.env` ativo **continuam reais** (não dependem do banco) — extração e envio de WhatsApp funcionam de verdade mesmo com o banco local. Só `RESEND_API_KEY` está vazia (e-mail cai no stub). **"Disparar confirmações" e a cadência do dia mandam WhatsApp de verdade** mesmo em dev — pra testar sem risco, usar o card "Enviar teste" em Configurações → WhatsApp (`POST /api/whatsapp/signup/test-send`), que nunca consulta paciente/agendamento no banco.
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

**Nunca executado de verdade**: o envio real de WhatsApp pro paciente (falta confirmar entrega — usar o card "Enviar teste") e o fluxo novo de upload/preview/popup de agenda no navegador (ver "Estado atual"). A extração em si **já foi validada de verdade** contra 4 PDFs reais/exemplo — não depende mais de credencial nenhuma. Os testes cobrem a lógica pura (telefone, classificação de resposta, mapeamento da extração, alertas de fechamento, os dois parsers de extração, casamento de nome pro preview), não a integração de rede/banco.

**Fase 2 completa** conforme escopo do PLANO.md: lembrete D-1, reenvio por telefone alternativo, sugestão de confirmações, expurgo LGPD, classificação por IA de texto livre ambíguo, reposição de vagas via lista complementar, relatório automático por e-mail ao concluir a lista, e resumo diário para o gestor.

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

## Notas técnicas que não são óbvias

- **A extração de listas não usa mais IA** (ver seção acima) — histórico: chegou a rodar com `claude-opus-5`, depois `claude-haiku-4-5-20251001`, antes de virar parser local em 2026-08-06. `@anthropic-ai/sdk` continua no projeto só por causa de `modules/replies` (classificação de resposta ambígua) — regra central lá: campo ilegível vira `null`/`"unknown"` com confiança baixa, nunca um chute.
- **`react-router-dom` fica na versão mais recente (7.18.x) mesmo com um aviso do `npm audit`.** O aviso é GHSA-2w69-qvjg-hvjx (CSRF em **RSC mode**), que não se aplica: usamos SPA com `BrowserRouter`, sem React Server Components nem server actions. A "correção" que o npm sugere é descer para 7.11.0, que é afetada por **13 outros** avisos. Não descer de versão.
- `@theme inline` no `index.css` mapeia os tokens do Tailwind para variáveis CSS próprias, que trocam no seletor `.dark`. Por isso as utilidades (`bg-sheet`, `text-ink`…) acompanham o tema sozinhas.
- O build do Vite sai em `dist-web/` e o Express serve dali em produção (`WEB_DIST` em `src/app.ts`); em dev são dois processos (`npm run dev` sobe os dois, com proxy `/api` do Vite para a porta 3000).
- `api/index.js` importa de `dist/`, não do TypeScript fonte — os aliases `@/...` já foram reescritos pelo `tsc-alias` no build.
- O webhook precisa tratar `statuses` (entrega/falha), diferente da barbearia-saas que os ignora: telefone errado na lista da prefeitura é rotina e vira indicador de qualidade devolvido à secretaria.

## Pendências externas (bloqueiam ir pra produção — dev local já funciona sem elas)

1. ~~Projeto Supabase dedicado de produção~~ — **feito**, mas guardado em `.env.production` (git-ignorado), não em uso no dia a dia: dev roda no Postgres local via Docker (ver "Ambiente local"). Publicar de verdade = trocar `DATABASE_URL`/`DIRECT_URL` do `.env` ativo pelos valores de `.env.production`, com confirmação explícita antes — decisão de 2026-07-27, depois do incidente de apontar sem querer pra produção.
2. ~~Número de WhatsApp Business + token~~ — **feito**: `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` reais no `.env`, conectado como fallback "via variável de ambiente" (tier `TIER_250` confirmado em Configurações → WhatsApp). Falta confirmar se os **templates foram de fato aprovados e o envio chega no paciente** — o usuário não tinha certeza em 2026-07-27. Use o card "Enviar teste" pra checar isso com o próprio número antes de confiar em disparo real.
   - Conectar a conta pelo sistema (Configurações → WhatsApp → Embedded Signup), como alternativa ao token direto no `.env`. **Análise do app `dgs-system` aprovada pela Meta em 2026-08-08** (`whatsapp_business_messaging`, `whatsapp_business_management` — ver print em Ações necessárias → Envios de análise do app). Ícone (`docs/meta-app-icon-1024.png`, 1024×1024) e Política de Privacidade (`web/public/privacidade.html`, publica em `/privacidade.html`) **prontos em 2026-08-09** — falta só subir o ícone no painel da Meta e gerar a "Configuration" do Embedded Signup (dá `WHATSAPP_APP_ID`/`WHATSAPP_SIGNUP_CONFIG_ID`); a URL da política só fica acessível de verdade depois do deploy (item 1).
   - **Templates**: todos aprovados, mas sob o WABA "Test WhatsApp Business Account" (`WHATSAPP_BUSINESS_ACCOUNT_ID` no `.env` já é esse mesmo ID — confirmado em 2026-08-09, não precisa trocar nada de config). Falta confirmar em WhatsApp Manager → Números de telefone se o número ligado a esse WABA é um **número de produção verificado** ou o **"Test Number"** temporário da Meta (que só manda mensagem pra até 5 destinatários pré-verificados) — se for o de teste, precisa registrar um número real nesse mesmo WABA antes de disparar em massa pra paciente de verdade.
3. ~~Chave da API Anthropic para extração~~ — **não é mais pendência**: a extração de listas parou de usar IA em 2026-08-06 (ver "Extração de listas: local, sem IA"). `ANTHROPIC_API_KEY` no `.env` ainda importa só pra `modules/replies` (classificação de resposta ambígua).
4. ~~Chave do Resend (`RESEND_API_KEY`)~~ — **decisão do usuário (2026-08-09): manter sem Resend por enquanto**, a não ser que ele peça pra retomar. Relatório por e-mail e resumo diário do gestor continuam caindo no stub de log.
5. ~~PDFs reais de 2–3 prefeituras para calibrar o prompt de extração~~ — **feito**: os parsers SISREG e CELK foram validados campo a campo contra 4 PDFs reais/exemplo de 2 prefeituras (Pomerode, Camboriú) — ver seção "Extração de listas: local, sem IA". Continua valendo testar contra PDF novo com `npm run extrair -- caminho/do/arquivo.pdf` sempre que aparecer uma prefeitura nova ou um formato `OUTRO`.
6. ~~Valores de `doctor_fee` e `city_rate` por procedimento~~ — **fora de escopo por decisão do usuário (2026-08-09)**: o módulo financeiro (repasse/faturamento/margem) não entra nesta fase — ver PLANO.md.
7. ~~Plano Pro da Vercel pro cron horário~~ — **fora de escopo por decisão do usuário (2026-08-09)**: disparo é manual em massa mesmo, a equipe só acompanha confirmações depois — não precisa de cron automático. Continua como está: sem cron nenhum, cadência do dia rodada na mão pelo botão "Rodar cadência do dia" em Acompanhamento (`POST /api/queue/run-cadence`).
8. **Hospedagem: Vercel (decisão de 2026-08-09), não Cloudflare.** `vercel.json` + `api/index.js` já prontos; a extração de PDF depende de `pdf-parse` (binário Node) e a sessão usa `connect-pg-simple` (driver `pg` nativo) — migrar pra Cloudflare Workers exigiria reescrever essas duas peças pra rodar em V8 isolates, sem ganho claro. Falta só: trocar `DATABASE_URL`/`DIRECT_URL` pra produção (item 1) + `git push` + `vercel --prod`, com confirmação explícita antes (decisão de 2026-07-26/27 continua valendo).
