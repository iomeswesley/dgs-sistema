# Sistema DGS — Plano do projeto

> Última atualização: 2026-07-25. Ferramenta **interna** da DGS (D'Artibale Gestão em Saúde), empresa que intermedia secretarias municipais de saúde e médicos contratados. Uso exclusivo da equipe da empresa.

## O problema

A DGS recebe **diariamente** das prefeituras listas em PDF (cada prefeitura tem seu formato, mas todas trazem as mesmas informações-chave): nome do paciente, telefone, procedimento, médico responsável e localidade/data. Hoje a confirmação de comparecimento é feita à mão — as atendentes disparam mensagens do WhatsApp comum, uma a uma ou por lista de transmissão, e anotam as respostas com marca-texto no papel impresso.

Dois problemas graves nesse processo:

1. **Os números vivem sendo bloqueados pela Meta** — disparo em massa de número comum é spam aos olhos do WhatsApp. Esse é o argumento nº 1 do sistema: a Cloud API oficial com templates aprovados elimina o risco de ban.
2. **Nada fica registrado de forma utilizável** — não há histórico, indicador, nem cruzamento entre o que foi confirmado, o que foi atendido e o que foi efetivamente pago.

## O que o sistema faz

### Núcleo (função primária)

1. **Recebe os PDFs/fotos diários** como upload no painel.
2. **Extrai os dados com IA (Claude)** — um único pipeline que entende qualquer formato de lista, devolvendo estrutura (nome, telefones, procedimento, médico, data/hora, município).
3. **Tela de revisão humana** — a equipe confere/corrige antes de qualquer disparo; linhas de baixa confiança destacadas, PDF original lado a lado.
4. **Disparo em massa via WhatsApp Cloud API** — template aprovado com botões **"Sim, vou comparecer" / "Não poderei ir"**, através de uma fila com throttle que respeita o limite diário da Meta.
5. **Compila as respostas** — webhook recebe cliques dos botões e status de entrega; dashboard mostra confirmados, recusados (com motivo), sem resposta e falhas.
6. **Exporta o resultado** — relatório por lista/médico/município pra devolver à secretaria.

### Camada de gestão

7. **Conciliação em 3 etapas** — o número real de atendimentos passa por três checagens independentes:
   - **Check 1 — Confirmados**: o que o sistema apurou via WhatsApp (automático).
   - **Check 2 — Atendidos**: quantos o médico informa ter atendido (equipe digita no painel).
   - **Check 3 — Pagos**: o número real conferido pelo financeiro nas guias dos exames — é o que efetivamente vira pagamento.
8. **Indicadores históricos** por médico, cidade, procedimento e período.
9. **Sugestão de confirmações** (fase 2) — quantas confirmações buscar pra fechar a agenda esperada do médico, com base na taxa histórica de comparecimento.
10. **Reposição de vagas** (fase 2) — relatório de horários vagos pra secretaria mandar lista complementar, maximizando os atendimentos do médico.

## Decisões tomadas

| Decisão | Escolha |
|---|---|
| Modelo | Interno, uma empresa (sem multi-tenant, sem billing). Estrutura preparada pra multi-tenantizar depois se virar produto. |
| Usuários | Só a equipe da DGS, **perfil único** (sem roles) — mas todo lançamento manual é auditado. Secretarias e médicos recebem relatório exportado, sem login. |
| Extração | Claude API (PDF e imagem nativos) + revisão humana obrigatória. Sem parser fixo por prefeitura. |
| Check 2 (atendidos) | Médico informa como hoje; a equipe digita no painel. |
| Stack | React + Vite + TS + Tailwind (frontend); Node + Express + TS + Prisma + Postgres/Supabase (backend); Vitest; Sentry; helmet. Reaproveita o código de WhatsApp Cloud API da barbearia-saas. |
| Deploy | Vercel (mesmo fluxo da barbearia-saas). Projeto Supabase **novo e dedicado**. |

## Escala e operação (confirmado com o usuário)

- **Volume**: ~250–1.000 pacientes/dia (a confirmar) — exige escalar o tier da Meta nas primeiras semanas.
- **Escala**: 5–15 municípios, 10–40 médicos ativos.
- **Equipe**: 1–3 pessoas operando; listas chegam por WhatsApp/e-mail.
- **Antecedência**: listas chegam **2+ dias antes** do atendimento → cadência completa é viável.
- **Financeiro**: prefeitura paga a DGS **por procedimento realizado**; médico recebe **por produção**. Margem = `city_rate − doctor_fee`.

## Formatos reais de lista já conhecidos

Dois exemplos reais analisados, ambos de Santa Catarina, sistemas diferentes:

**1. SISREG III (ex.: Indaial/SC)** — relatório "Propriedades da Agenda":
- Cabeçalho: unidade executante, período, profissional executante (nome + código), procedimento ambulatorial.
- Por linha: cód. solicitação, data/hora, CNS, nome, nome social, nascimento, idade, origem, **1–2 telefones**, unidade solicitante (UBS), vaga (**1ª VEZ / RETORNO**), CID-10.

**2. CELK Saúde (ex.: Prefeitura de Penha)** — "Relação da Agenda para Contato":
- Cabeçalho: unidade executante, período, profissional, paginação (listas multi-página, ~1.298 itens no exemplo).
- **Agrupado por tipo de procedimento dentro do mesmo médico** — o procedimento é do grupo/seção, não coluna da linha.
- Por linha: paciente, idade, **até 4 colunas de telefone + celular**, data e hora, convênio.

**Implicações:**
- **Múltiplos telefones por paciente é a regra**: guardar todos, escolher o melhor candidato a WhatsApp (celular > fixo), fazer fallback pro próximo se o envio falhar.
- **Extração em dois níveis**: metadados da lista (médico, procedimento, unidade, período) no cabeçalho + dados por paciente nas linhas; no CELK o procedimento vem por seção.
- **Input pode ser foto**, não só PDF — o material às vezes chega fotografado, torto, com dedo na borda. Claude lê ambos; foto ruim → flag de baixa confiança.
- Pacientes **sem telefone** ou com número inválido → status `sem_telefone`, no relatório como "não contatável".
- CNS entra no relatório (identifica o paciente pra secretaria); **CID-10 nunca entra na mensagem de WhatsApp**.
- As anotações à mão nas listas impressas (marca-texto = contatado, vermelho = recusou com o motivo escrito ao lado) são exatamente o que o sistema substitui — daí o campo de **motivo da recusa**.

## Modelo de dados

Contagens derivadas (planejados, confirmados, recusados, sem resposta) **nunca são digitadas** — sempre calculadas de `appointments`. Só os checks 2 e 3 são lançamentos manuais.

- **`users`** — equipe da DGS (login/senha, recuperação por e-mail).
- **`municipalities`** — prefeituras/secretarias (nome, contato, observações de formato da lista).
- **`units`** — unidades de saúde com endereço (executantes e solicitantes). A mensagem precisa dizer **onde** é o atendimento.
- **`doctors`** — médicos contratados (nome, especialidade, registro).
- **`procedures`** — procedimentos, com `preparation_instructions` (jejum, bexiga cheia, etc.) enviadas no lembrete de véspera.
- **`doctor_procedures`** — config por médico × procedimento: `minutes_per_visit`, `expected_per_day`, **`doctor_fee`** (valor pago ao médico), **`city_rate`** (valor cobrado da prefeitura), ativo/inativo.
- **`agendas`** — escala do médico: médico + município + unidade + data + turno + procedimento + capacidade. O sistema sabe o esperado **antes** da lista chegar.
- **`patients`** — entidade própria, dedupe por CNS + telefone. Guarda histórico entre listas, **score de no-show** individual e **`opted_out`** (LGPD).
- **`lists`** — cada arquivo recebido: arquivo original, município, agenda vinculada (**N:1** — uma agenda pode ter lista original + complementares), status (`extraindo → em_revisao → aprovada → disparada → concluida`), quem subiu/aprovou.
- **`appointments`** — cada linha: paciente, **telefones[] em E.164** + telefone escolhido, procedimento, médico, data/hora, 1ª vez/retorno, unidade solicitante, status (`pendente → enviado → entregue → confirmado | recusado | sem_resposta | sem_telefone | falha`), **`refusal_reason_code`** padronizado + texto livre, `contacted_manually_by/_at`, confiança da extração.
- **`whatsapp_messages`** — log de cada envio e resposta (wamid, template, timestamps, status de entrega via webhook `statuses`).
- **`daily_closings`** — 1 linha por (médico, município, data[, procedimento]): `attended_reported` (check 2), `paid_count` (check 3), **`extras_count`** (encaixes — pacientes atendidos fora da lista), `guia_files` (evidência), cada campo com `*_by` e `*_at`, observação livre.
- **`audit_log`** — toda alteração de lançamento manual (tabela, registro, campo, valor antigo → novo, usuário, timestamp). Compensa a ausência de perfis separados.

### Taxonomia de motivo de recusa

`ja_fez` · `horario_ruim` · `sem_transporte` · `mudou_se` · `telefone_errado` · `obito` · `outro` (+ texto livre).

"% telefone errado por município" vira **indicador de qualidade da lista**, devolvido à secretaria.

## Indicadores

| Indicador | Fórmula | Leitura |
|---|---|---|
| % Confirmação | confirmados ÷ planejados (com telefone) | eficácia do disparo |
| % Comparecimento | atendidos (check 2) ÷ confirmados | no-show dos que disseram sim |
| % Aproveitamento | atendidos ÷ planejados | visão da secretaria |
| Divergência médico × guias | pagos (check 3) ÷ atendidos (check 2) | controle financeiro |
| Repasse ao médico | pagos × `doctor_fee` | fechamento mensal |
| Faturamento / margem | pagos × `city_rate` − repasse | por município e procedimento |

Todos com drill-down por **médico**, **município**, **procedimento** e **período** (dia/semana/mês), e série histórica exportável.

**Alertas de inconsistência automáticos**: atendidos > confirmados + encaixes; pagos > atendidos; divergência médico×guias acima de X% → destaque no painel de fechamento, não descoberta silenciosa.

## Painéis

1. **Listas** — upload, extração, revisão, aprovação, disparo.
2. **Acompanhamento do dia** — por lista/médico: confirmados, recusados (com motivo), sem resposta, falhas; ações de reenvio e de contato manual.
3. **Fechamento** — grade médico × dia pra lançar `attended_reported`, `paid_count` e encaixes, com os números do sistema ao lado pra digitação consciente.
4. **Indicadores** — os indicadores acima com filtros e gráficos (série temporal + ranking por médico/município), export Excel.
5. **Configurações** — municípios, unidades, médicos, procedimentos e a sub-aba **Procedimentos por médico** (tempo por consulta, esperados/dia, valores).

## Cadência de mensagens

- **D-2 — Confirmação** (template 1, com botões Sim/Não).
- **Reenvio** pra sem-resposta — nunca o mesmo template pro mesmo paciente no mesmo dia; retry só via telefone alternativo ou no dia seguinte.
- **D-1 — Lembrete** (template 2) só pra quem confirmou, com documentos e instruções de preparo.
- **Fase 2** — convite pra vaga aberta (template 3), resumo do dia pro gestor.

Detalhes de texto, variáveis e proteção contra bloqueio: **[TEMPLATES-WHATSAPP.md](TEMPLATES-WHATSAPP.md)**.

## Sugestão de confirmações (fase 2, schema já prevê)

`sugestão = teto(expected_per_day ÷ taxa_comparecimento_histórica)`, com a taxa das últimas N semanas daquele médico+procedimento (fallback: médico → município → global). Exibida na revisão da lista: *"esperados 20 atendimentos, taxa histórica 78% → busque ~26 confirmações"*.

## Reposição de vagas (fase 2)

Sistema fecha o número de recusados → gera **relatório de horários vagos** → secretaria manda **lista complementar** → importada **vinculada à mesma agenda** → dispara só pros horários vagos. É o que transforma o sistema de "prever comparecimento" em "maximizar atendimento".

## Estrutura segura

- **Auth**: sessão server-side (connect-pg-simple, como barbearia-saas), bcrypt, rate limit no login, cookie `HttpOnly + Secure + SameSite=Lax`, helmet, recuperação de senha por e-mail.
- **Auditoria**: `audit_log` em todo lançamento/edição manual.
- **LGPD (dado de saúde é dado sensível)**: storage privado dos arquivos originais (URL assinada de curta duração), expurgo automático após N meses (arquivos + mensagens; **agregados dos indicadores ficam** — histórico de % não precisa de dado pessoal), nada de nome/CNS/CID em logs ou Sentry, CID nunca na mensagem. Base legal: tutela da saúde / execução de política pública, com a secretaria como controladora e a DGS como operadora.
- **Webhook WhatsApp**: validação de assinatura **fail-closed** (lição da barbearia-saas), idempotência por `wamid`, tratamento de `statuses` (entrega/falha é parte do produto).
- **Upload**: validar MIME/tamanho, nunca servir o arquivo de volta sem auth.
- **Secrets**: só via env (Vercel/Supabase), nunca em código ou chat.

## Fases

### Fase 1 — MVP
- Login da equipe.
- Cadastros: municípios, unidades, médicos, procedimentos, procedimentos por médico (com valores), agendas.
- Upload (PDF/foto) → extração Claude → revisão → aprovação.
- Disparo com template de botões + fila com throttle e controle de limite diário.
- Webhook: respostas dos botões, statuses de entrega, opt-out.
- Acompanhamento do dia + registro de contato manual e motivo de recusa.
- Fechamento (checks 2 e 3) com alertas de inconsistência.
- Indicadores com filtros + export Excel.

### Fase 2 — Operação madura
- Lembrete D-1 automático com instruções de preparo.
- Reenvio automático pra sem-resposta; fallback por telefone alternativo.
- Classificação IA das respostas de texto livre.
- Sugestão de confirmações (overbooking calculado).
- Reposição de vagas via lista complementar.
- Relatório automático por e-mail pra secretaria/médico; resumo do dia pro gestor.
- Score de no-show por paciente.

### Fase 3 — Evoluções
- Reagendamento assistido pelo bot.
- Portal read-only pra secretarias/médicos.
- Multi-tenant, se virar produto pra outras intermediadoras.

## Pré-requisitos externos (fora do código)

- [ ] Número de WhatsApp Business dedicado + app na Meta (Cloud API), com verificação do negócio.
- [ ] **Templates submetidos à aprovação da Meta** — maior lead time do projeto, começar já (ver [TEMPLATES-WHATSAPP.md](TEMPLATES-WHATSAPP.md)).
- [ ] Projeto Supabase novo (banco dedicado, não compartilhar com os outros projetos).
- [ ] Chave da API Anthropic pra extração.
- [ ] Conta Vercel (novo projeto) + Sentry.
- [ ] PDFs reais de 2–3 prefeituras diferentes pra calibrar o prompt de extração.
- [ ] Valores de `doctor_fee` e `city_rate` por procedimento.

## Convenções de trabalho

- `npx tsc --noEmit` + `npx vitest run` limpos antes de qualquer commit; commit + push sem perguntar depois de validado.
- Manter este arquivo atualizado a cada mudança relevante (é a fonte de verdade do projeto).
- Nunca `alert()`/`window.confirm()` — modal próprio.
- Selects com `color-scheme: light dark` + fundo sólido (dark mode).
- **Nunca disparar WhatsApp real pra telefone de paciente em teste** — sempre número próprio de teste, dados prefixados `[teste]`.
- Nunca colar chaves/secrets no chat ou em arquivos versionados.
