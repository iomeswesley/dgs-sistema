# Templates de WhatsApp — Sistema DGS

> Prontos pra cadastrar no Meta Business Manager → WhatsApp Manager → Modelos de mensagem.
> **Submeter à aprovação o quanto antes** — é o item de maior lead time do projeto (de horas a dias, e pode exigir ajuste de texto).

---

## Diagnóstico: por que os números estão sendo bloqueados hoje

Analisado a partir dos prints da operação atual (2026-07-25). A causa principal **não é o texto** — são três coisas no *jeito de enviar*:

1. **Lista de transmissão** ("16 contatos" fixado no topo da conversa). O WhatsApp trata broadcast pra gente que não tem seu número salvo na agenda como spam clássico. É o gatilho mais forte de todos.
2. **Mensagem marcada como "Reencaminhada"**. Encaminhar o mesmo bloco de texto em série é assinatura de spam e a Meta pontua isso explicitamente.
3. **Template mestre enviado com os campos em branco** — nos prints aparece literalmente "Me chamo XXXXX", "consulta em XXXX", "Data: XX/07/2026" e horário vazio. Pacientes receberam a mensagem crua. Isso gera confusão, denúncia e bloqueio.

Problemas secundários, do texto em si:

4. **Longa demais** — ~950 caracteres, com ~10 linhas de instruções operacionais **antes** da pergunta.
5. **Resposta por texto livre** ("Responda SIM ou NÃO") em vez de botões. Nos prints dá pra ver o efeito: a paciente responde *"Tá conseguindo"*, depois *"Posso confirmar?"*, e só então *"Sim"* — três idas e voltas pra uma pergunta de sim/não, e uma resposta que um parser ingênuo classificaria errado.
6. **Sem opt-out.** Sem uma saída fácil, o único botão que o paciente conhece é "Bloquear/Denunciar" — e **é a denúncia do usuário que derruba o número**, mais do que o volume.

O que a Cloud API resolve sozinha: o item 3 vira impossível (variável não preenchida = envio rejeitado pela API), os itens 1 e 2 deixam de existir (cada envio é individual e nativo, sem encaminhamento), e o disparo em massa passa a ser um uso autorizado em vez de uma violação.

---

## Template 1 — Confirmação (D-2)

- **Nome**: `confirmacao_consulta`
- **Categoria**: `UTILITY`
- **Idioma**: Português (BR) — `pt_BR`

**Header** (tipo: Texto)
```
Confirmação de consulta - {{1}}
```

**Body**
```
Olá, {{1}}! Aqui é a DGS, que organiza os atendimentos da Secretaria de Saúde de {{2}}.

Você tem uma consulta marcada:

Data: {{3}} às {{4}}
Procedimento: {{5}}
Local: {{6}}

Podemos confirmar sua presença?
```

**Footer**
```
DGS - D'Artibale Gestão em Saúde
```

**Botões** (Resposta rápida)
- `Sim, vou comparecer`
- `Não poderei ir`

**Variáveis**

| Campo | Var | Origem | Exemplo (usar na submissão) |
|---|---|---|---|
| Header | `{{1}}` | `municipalities.name` | `Penha` |
| Body | `{{1}}` | `patients.name` (primeiro nome) | `Arthur` |
| Body | `{{2}}` | `municipalities.name` | `Penha` |
| Body | `{{3}}` | data da consulta | `23/07/2026` |
| Body | `{{4}}` | hora da consulta | `09:15` |
| Body | `{{5}}` | `procedures.name` | `Ultrassonografia obstétrica` |
| Body | `{{6}}` | `units.name` + endereço curto | `Policlínica - Av. Eugênio Krause, 2265, Centro` |

**Por que essa forma**: o nome do paciente na primeira linha prova que não é disparo genérico; a segunda linha explica de onde veio o dado, o que legitima a mensagem em uma frase (sem depender do nome de uma atendente que a pessoa não conhece); uma pergunta só, respondida em um toque. ~320 caracteres contra ~950 de hoje.

**O que saiu de propósito**: as instruções sobre autorização do exame e documentos foram pro lembrete D-1 — quem responde "não poderei ir" não precisa lê-las, e encurtar a confirmação aumenta a taxa de resposta.

---

## Template 2 — Lembrete de véspera (D-1, só pra quem confirmou)

- **Nome**: `lembrete_vespera`
- **Categoria**: `UTILITY`

**Body**
```
Olá, {{1}}! Lembrando da sua consulta amanhã:

Data: {{2}} às {{3}}
Procedimento: {{4}}
Local: {{5}}

Leve com você:
- Documento de identificação com foto
- Encaminhamento médico

Importante: retire a autorização do exame na Unidade Solicitante (UBS, Policlínica ou Hospital) antes da consulta. Se já retirou, é só comparecer no horário.

{{6}}
```

**Footer**
```
DGS - D'Artibale Gestão em Saúde
```

**Botões** (Resposta rápida)
- `Confirmado, estarei lá`
- `Não poderei mais ir`

**Variáveis**: `{{1}}` nome · `{{2}}` data · `{{3}}` hora · `{{4}}` procedimento · `{{5}}` local · `{{6}}` `procedures.preparation_instructions` (jejum, bexiga cheia, etc. — quando o procedimento não tiver preparo, preencher com um texto neutro curto, ex.: `Qualquer dúvida, procure a unidade de saúde do seu bairro.`, porque a Meta **não aceita variável vazia**).

O botão "Não poderei mais ir" aqui é valioso: pega a desistência de última hora com 24h de antecedência, tempo suficiente pra secretaria repor a vaga.

---

## Template 3 — Convite pra vaga aberta (Fase 2)

- **Nome**: `convite_vaga_aberta`
- **Categoria**: `UTILITY`

**Body**
```
Olá, {{1}}! Aqui é a DGS, que organiza os atendimentos da Secretaria de Saúde de {{2}}.

Abriu uma vaga para {{3}}:

Data: {{4}} às {{5}}
Local: {{6}}

Você tem interesse nesse horário?
```

**Botões**: `Sim, quero a vaga` · `Não, obrigado`

Usado quando a secretaria manda lista complementar pra preencher horários vagos.

---

## Práticas de envio que protegem o número

- **Opt-out honrado de verdade**: quem responder "SAIR"/"PARE"/"NÃO QUERO RECEBER" entra em `patients.opted_out` e nunca mais recebe nada. É a defesa mais barata contra denúncia.
- **Um template por paciente por dia, no máximo.** Retry só via telefone alternativo ou no dia seguinte.
- **Ramp-up de volume**: nas primeiras semanas subir gradualmente pra Meta elevar o tier (250 → 1.000 → 10.000 conversas/24h) sem penalizar a qualidade. Com ~250–1.000 pacientes/dia previstos, o tier inicial aperta — planejar isso já no piloto.
- **Monitorar o quality rating** do número (verde/amarelo/vermelho) no painel; se cair, reduzir cadência e revisar texto **antes** de virar restrição de envio.
- **Janela de 24h**: mensagem livre só chega dentro de 24h da última atividade do paciente. Fora dela, só template. (Mesma regra já conhecida do projeto barbearia-saas.)
- **Nunca colocar CID-10, diagnóstico ou qualquer detalhe clínico** na mensagem — só o nome do procedimento, que já é o mínimo necessário.

## Checklist de submissão à Meta

- [ ] Número dedicado da DGS registrado na Cloud API, com verificação do negócio concluída.
- [ ] Perfil do WhatsApp Business preenchido (nome "DGS - D'Artibale Gestão em Saúde", foto, descrição, endereço) — perfil vazio prejudica a aprovação e a confiança do paciente.
- [ ] Template 1 submetido com exemplos preenchidos (a Meta rejeita se os exemplos vierem em branco ou com `XXXX`).
- [ ] Template 2 submetido.
- [ ] Template 3 submetido (pode ser depois, é fase 2).
