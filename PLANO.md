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

## Modelo de dados (rascunho)

- `users` — equipe da empresa (login/senha, recuperação como na barbearia).
- `municipalities` — prefeituras/secretarias (nome, contato, observações de formato do PDF).
- `doctors` — médicos contratados (nome, especialidade).
- `lists` — cada PDF recebido: arquivo original, município, data do atendimento, status (`extraindo → em_revisao → aprovada → disparada → concluida`), quem subiu/aprovou.
- `appointments` — cada linha da lista: paciente (nome, telefone E.164), procedimento, médico, data/hora, status de confirmação (`pendente → enviado → entregue → confirmado | recusado | sem_resposta | falha`), confiança da extração, corrigido manualmente ou não.
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
