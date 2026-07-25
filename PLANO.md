# Sistema DGS — Plano do projeto

> Planejamento inicial (2026-07-23). Ferramenta **interna** da empresa que intermedia secretarias de saúde municipais e médicos contratados. Uso exclusivo da equipe da empresa.

## O problema

A empresa recebe **diariamente** das prefeituras listas em PDF (cada prefeitura tem seu formato, mas todas trazem as mesmas informações-chave): nome do paciente, telefone, procedimento, médico responsável e localidade/data. Hoje a confirmação de comparecimento é manual.

## O que o sistema faz (função primária)

1. **Recebe os PDFs diários** como upload no painel.
2. **Extrai os dados com IA (Claude)** — um único pipeline de extração que entende qualquer formato de PDF, devolvendo a lista estruturada (nome, telefone, procedimento, médico, data/hora, município).
3. **Tela de revisão humana** — a equipe confere/corrige os dados extraídos antes de qualquer disparo (telefones inválidos, nomes truncados, campos com baixa confiança ficam destacados).
4. **Disparo em massa via WhatsApp** — mensagem de confirmação com **botões "Sim, confirmo" / "Não poderei ir"** (Message Template aprovado da Cloud API, categoria UTILITY, quick reply buttons).
5. **Compila as respostas** — webhook recebe os cliques dos botões e o dashboard mostra, por lista/município/médico: confirmados, recusados, sem resposta, falhas de entrega.
6. **Exporta o resultado** — relatório (PDF/Excel) da lista com o status de cada paciente, pra devolver à secretaria/médico.

## Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Modelo | Interno, uma empresa só (sem multi-tenant, sem billing). Estrutura preparada pra multi-tenantizar depois se virar produto. |
| Usuários do painel | Só a equipe da empresa (secretarias e médicos recebem relatório exportado, não têm login — fase futura se precisar). |
| Extração dos PDFs | Claude API (PDF nativo) + revisão humana obrigatória antes do disparo. Sem parser fixo por prefeitura. |
| Stack | "O mais profissional possível": frontend React + Vite + TS + Tailwind; backend Node + Express + TS + Prisma + Postgres (Supabase); Vitest; Sentry; helmet. Reaproveita o código de WhatsApp Cloud API da barbearia-saas (`src/lib/whatsapp.ts`, webhook com validação de assinatura fail-closed, templates com botões). |

## Arquitetura

```
PDF (upload) ──► Claude API ──► extração JSON ──► tela de revisão ──► fila de envio
                                                                          │
Dashboard ◄── webhook (respostas dos botões) ◄── WhatsApp Cloud API ◄─────┘
    │
    └──► export PDF/Excel por lista
```

- **Monorepo**: `web/` (React SPA) + `server/` (Express API) — ou estrutura única estilo barbearia-saas com SPA em `webroot/`; decidir no bootstrap.
- **Banco**: Postgres (Supabase) via Prisma. Um banco só (padrão dos outros projetos), dados de teste prefixados `[teste]`.
- **Deploy**: Vercel (mesmo fluxo da barbearia-saas: push → deploy, promover manualmente se preciso).
- **Fila de envio**: disparo em massa é assíncrono — tabela de fila no Postgres + processamento em lote com throttle e retry (Vercel cron ou endpoint de processamento). Necessário por causa dos rate limits da Meta.

## Formatos reais já conhecidos (fotos recebidas 2026-07-23)

Dois exemplos reais analisados — ambos de Santa Catarina, sistemas diferentes:

**1. SISREG III (ex.: Indaial/SC)** — relatório "Propriedades da Agenda":
- Cabeçalho (metadados da lista inteira): unidade executante, período, profissional executante (nome + código), procedimento ambulatorial (ex.: "Consulta em Psiquiatria – Geral").
- Por linha: cód. solicitação, **data/hora da consulta**, CNS, nome, nome social, nascimento, idade, origem (município), **1–2 telefones**, unidade solicitante (UBS de origem), vaga solicitada (**1ª VEZ / RETORNO**), CID-10.

**2. CELK Saúde (ex.: Prefeitura de Penha)** — "Relação da Agenda para Contato":
- Cabeçalho: unidade executante (Policlínica), período, profissional, paginação ("Página 001 de 003" — listas são multi-página, ~1.298 itens no exemplo).
- Agrupado por **tipo de procedimento dentro do mesmo médico** (ex.: ultrassom obstétrico e ultrassom de articulação na mesma lista) — o procedimento é do grupo, não coluna da linha.
- Por linha: paciente, idade, **até 4 colunas de telefone + celular**, data e hora, convênio.

**Implicações pro sistema:**
- **Múltiplos telefones por paciente** é a regra, não exceção: guardar todos, escolher o melhor candidato a WhatsApp (celular > fixo, DDD local > de fora), e fazer fallback pro próximo número se o envio falhar.
- **Metadados no cabeçalho, não na linha**: a extração tem dois níveis — dados da lista (médico, procedimento, unidade, período) e dados por paciente. No CELK o procedimento vem por grupo/seção.
- **As anotações à mão nas fotos mostram o processo manual atual**: marca-texto = contatado, vermelho = recusou, com o **motivo escrito ao lado** ("não quer ir pois já fez acompanhamento", "não pode ir por conta do serviço"). O sistema precisa de campo de **motivo da recusa** (capturado da resposta livre do paciente ou anotado pela equipe) — isso vai no relatório devolvido à secretaria.
- **Input pode ser foto, não só PDF**: hoje o material chega às vezes fotografado (inclusive torto, com dedo na borda). O upload aceita PDF **e** imagem (JPG/PNG); Claude lê ambos. Fotos de baixa qualidade → linhas com flag de baixa confiança na revisão.
- Alguns pacientes vêm **sem telefone nenhum** ou com número visivelmente inválido → status próprio (`sem_telefone`) já na revisão, listado no relatório final como "não contatável".
- CID-10 e CNS são dados sensíveis: capturar só se úteis pro relatório (CNS ajuda a identificar o paciente pra secretaria); nunca incluir CID na mensagem de WhatsApp.

## Modelo de dados (rascunho)

- `users` — equipe da empresa (login/senha, recuperação como na barbearia).
- `municipalities` — prefeituras/secretarias (nome, contato, observações de formato do PDF).
- `doctors` — médicos contratados (nome, especialidade).
- `lists` — cada PDF recebido: arquivo original, município, data do atendimento, status (`extraindo → em_revisao → aprovada → disparada → concluida`), quem subiu/aprovou.
- `appointments` — cada linha da lista: paciente (nome, CNS opcional, **telefones[] em E.164** + telefone escolhido pro disparo), procedimento, médico, data/hora da consulta, 1ª vez/retorno, unidade solicitante, status de confirmação (`pendente → enviado → entregue → confirmado | recusado | sem_resposta | sem_telefone | falha`), **motivo da recusa** (texto), confiança da extração, corrigido manualmente ou não.
- `whatsapp_messages` — log de cada envio e resposta (wamid, template usado, timestamps, status de entrega via webhook `statuses`).

## Pontos de atenção técnicos

1. **Message Templates**: disparo em massa é business-initiated → exige template aprovado pela Meta. Redigir e submeter o template cedo (aprovação pode demorar dias). Botões de quick reply suportados nativamente em template.
2. **Tier de envio da Meta**: número novo começa limitado (~250–1000 conversas/24h) e escala com uso e qualidade. A fila precisa respeitar o limite do dia e reportar "não coube no limite de hoje" em vez de falhar silenciosamente.
3. **Webhook de `statuses`**: diferente da barbearia (que ignora `statuses`), aqui **precisa** tratar — saber que a mensagem falhou/não entregou é parte do produto (telefone errado na lista da prefeitura é comum).
4. **Resposta fora dos botões**: paciente que responde texto livre ("vou sim", "não posso, remarca") — registrar como resposta manual e classificar com IA (sim/não/outro), com a equipe podendo sobrescrever.
5. **LGPD — dado de saúde é dado sensível**: nome + procedimento médico. Acesso só com login, TLS, minimizar retenção (política de expurgo dos PDFs e mensagens após N meses), não logar dados de paciente em texto plano no Sentry, base legal = execução de política pública/tutela da saúde pelo controlador (secretaria), com a empresa como operadora.
6. **Normalização de telefone**: E.164 BR, detectar fixos (não recebem WhatsApp), nono dígito, duplicados na mesma lista.
7. **Extração com confiança**: o prompt de extração devolve, por linha, um score/flag de confiança; linhas duvidosas ficam destacadas na revisão. Guardar sempre o PDF original pra conferência lado a lado.

## Fases

### Fase 1 — MVP (o núcleo do produto)
- Login da equipe (usuário/senha, padrão barbearia).
- CRUD mínimo de municípios e médicos.
- Upload de PDF → extração Claude → tela de revisão (edição inline, lado a lado com o PDF) → aprovação.
- Disparo em massa com template de botões + fila com throttle.
- Webhook: respostas dos botões + statuses de entrega.
- Dashboard por lista: contadores e tabela de pacientes com status.
- Export Excel/PDF da lista com resultados.

### Fase 2 — Operação madura
- Lembrete automático na véspera pra quem confirmou.
- Reenvio automático pra "sem resposta" após X horas.
- Classificação IA das respostas de texto livre.
- Relatório automático por e-mail pra secretaria/médico.
- Histórico e métricas agregadas (taxa de confirmação por município, por médico).

### Fase 3 — Possíveis evoluções
- Reagendamento assistido pelo bot (paciente que responde "não" indica novo horário).
- Portal read-only pra secretarias/médicos.
- Multi-tenant (se virar produto pra outras intermediadoras).

## Pré-requisitos externos (fora do código)

- [ ] Número de WhatsApp Business dedicado da empresa + app na Meta (Cloud API) — mesmo processo da barbearia-saas.
- [ ] Template de confirmação redigido e submetido pra aprovação da Meta.
- [ ] Projeto Supabase novo (banco dedicado, não compartilhar com os outros projetos).
- [ ] Chave da API Anthropic pra extração.
- [ ] Conta Vercel (novo projeto) + Sentry.
- [ ] Exemplos reais de PDFs de pelo menos 2–3 prefeituras diferentes pra calibrar o prompt de extração.

## Convenções herdadas dos outros projetos

- `npx tsc --noEmit` + `npx vitest run` limpos antes de qualquer commit; commit + push sem perguntar depois de validado.
- Nunca `alert()`/`window.confirm()` — modal próprio.
- Selects com `color-scheme: light dark` + fundo sólido (dark mode).
- Nunca testar envio real de WhatsApp contra telefone de paciente de verdade — sempre número próprio de teste.
- Manter este arquivo e o futuro `CLAUDE.md` atualizados a cada mudança relevante.
- Nunca colar chaves/secrets no chat ou em arquivos versionados.
