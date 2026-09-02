# Plano — sistema-dgs multi-cliente

> Documento de planejamento escrito em 2026-09-01, **antes** de qualquer código.
> Fonte da verdade do desenho. Atualizar conforme as fases forem entregues.
>
> Contexto: até aqui o sistema foi construído para **um cliente só** (a própria
> DGS). Vai passar a atender vários clientes, isolados entre si, com um perfil
> de administrador global. Ver também [PLANO.md](PLANO.md) (desenho original,
> onde multi-tenant aparecia como "Fase 3 — se virar produto") e
> [CLAUDE.md](CLAUDE.md) (estado atual e convenções).

---

## 1. O que muda e o que não muda

**Muda:** todo dado do domínio passa a pertencer a um cliente; cada cliente tem
seu próprio número de WhatsApp, seu próprio cadastro, seus próprios pacientes,
seu próprio teto diário de mensagens. Ninguém vê o dado de ninguém.

**Não muda:** o produto em si. Upload de PDF, extração, revisão, disparo,
cadência, cancelamento, conversas, fechamento e indicadores continuam
exatamente como estão hoje — só passam a rodar dentro do escopo de um cliente.
Nenhuma feature é removida nem repensada nesta migração.

**Fora de escopo (de propósito):** cobrança/billing por cliente, auto-cadastro
(quem cria cliente é a DGS, não é self-service como nos projetos irmãos), e
qualquer mudança no fluxo de aprovação da Meta que já está em andamento
(coexistência / `business_management` — ver CLAUDE.md).

---

## 2. Decisões já tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Arquitetura | **Multi-cliente de verdade** (um sistema, um banco), não clonar o projeto por cidade | É o único jeito de ter "admin vê tudo numa tela" e "gráfico por cliente" sem consultar N bancos na mão; e uma correção de bug vale pra todos de uma vez |
| Login da equipe | **Um login por pessoa**, com acesso concedido a um ou vários clientes | Bate com o jeito que a equipe já trabalha (mesma pessoa cuidando de várias prefeituras). Difere dos projetos irmãos, onde cada usuário pertence a um tenant só |
| WhatsApp | **Número independente por cliente**, em conta própria do cliente na Meta | Pedido explícito. O Embedded Signup que já existe foi feito exatamente pra isso (DGS é Provedor de Tecnologia; o cliente conecta a própria conta) |
| Admin global | Campo `isSuperAdmin` no próprio `User` | Diferente dos irmãos (credencial fixa em variável de ambiente) porque lá o admin é externo aos tenants. Aqui **todo mundo que loga já é da DGS** — mantém o mesmo login e a mesma auditoria de todo mundo |
| Paciente | **Isolado por cliente** (`Patient` ganha `clientId`) | Difere dos irmãos, onde o cliente final é global por telefone — decisão que já causou problema real de LGPD documentado por eles (exclusão numa empresa apaga o cadastro em todas). Aqui é dado de saúde: não repetir esse erro |

### `Client` não é a mesma coisa que `Municipality` — atenção

O schema **já tem** uma tabela `Municipality` (Camboriú, Blumenau, Pomerode,
Indaial). O `Client` novo é um nível **acima** disso:

- **Cliente "DGS"** → contém as 4 municipalidades que já existem hoje. A DGS é
  uma intermediária: um cliente que atende várias prefeituras.
- **Cliente "Cidade X"** (futuro) → uma prefeitura que contrata direto, com
  uma municipalidade só embaixo.

Ou seja: um cliente pode ter 1 ou N municipalidades. Confundir os dois
conceitos quebraria o caso da DGS, que é justamente o dado que já está em
produção.

---

## 3. Três achados críticos da investigação

Levantados lendo o código antes de planejar. Cada um quebraria em produção,
com paciente real, se a migração fosse feita "no óbvio".

### 3.1 Constraints de unicidade globais — quebram com dois clientes

O schema tem unicidade global em campos que **precisam** poder repetir entre
clientes:

| Campo | Hoje | Problema |
|---|---|---|
| `Patient.cns` | `@unique` global | **Grave.** A mesma pessoa atendida por dois clientes (perfeitamente normal — Camboriú e Balneário Camboriú são vizinhas) faria o segundo cadastro **falhar na inserção**. Uma lista inteira poderia quebrar por causa disso |
| `Procedure.name` | `@unique` global | Dois clientes não poderiam ambos ter "ULTRASSOM" |
| `Municipality` | `@@unique([name, state])` | Dois clientes não poderiam ambos atender "Blumenau" |

**Correção:** todas viram compostas com `clientId`
(`@@unique([clientId, cns])`, etc.).

**Ficam globais de propósito:** `User.email` (uma pessoa, um login),
`WhatsappMessage.wamid` (id da Meta, genuinamente único no mundo),
`PasswordReset.tokenHash`.

### 3.2 O webhook não sabe de qual cliente é a mensagem — risco de vazamento

Hoje, quando o paciente responde, o sistema acha o agendamento **só pelo
telefone, varrendo o banco inteiro**
([whatsapp.service.ts:23](src/modules/whatsapp/whatsapp.service.ts#L23)):

```ts
async function findAppointmentForPhone(phone: string) {
  return prisma.appointment.findFirst({
    where: { selectedPhone: { in: phoneCandidates(phone) }, status: { in: ["ENVIADO", "ENTREGUE"] } },
    ...
```

Com dois clientes, um "Sim" do paciente pode ser atribuído ao agendamento **do
cliente errado** se o mesmo telefone existir nos dois. E isso não é hipotético:
o CLAUDE.md já documenta casos reais de telefone reaproveitado entre pessoas e
fixo compartilhado por família neste projeto.

Pior: a Meta **já manda** a informação necessária pra evitar isso
(`metadata.phone_number_id`, em todo evento) — e o parser atual
([whatsapp-webhook.ts](src/lib/whatsapp-webhook.ts)) **descarta esse campo**,
nem o extrai.

**Correção:** o webhook passa a resolver primeiro
`phone_number_id → WhatsappAccount → clientId`, e só então procurar o
agendamento **dentro daquele cliente**. Se não conseguir resolver o cliente,
registra e não processa — nunca "chuta" no banco inteiro.

*Nota:* a verificação de assinatura do webhook continua global e está correta
assim — ela usa o segredo do **app** da Meta (a DGS é o Provedor de
Tecnologia, um app só para todos os clientes), não do número.

### 3.3 A fila de mensagens é global — um cliente atrapalha o outro

Hoje `processQueue()` processa **todo** `MessageJob` pendente do sistema, e o
teto diário é um só. Isso já é um comportamento conhecido e documentado
(CLAUDE.md: *"aprovar uma lista de teste disparou também 14 jobs de uma lista
antiga esquecida"*). Com vários clientes vira problema de verdade:

- O teto diário é **do número na Meta**, que passa a ser por cliente — não faz
  sentido continuar somando todo mundo num teto só.
- Uma lista de 2000 do cliente A não pode fazer as 10 do cliente B esperarem.

**Correção:** fila e teto passam a ser por cliente; o cron diário itera os
clientes ativos em vez de rodar uma vez global.

⚠️ **Detalhe importante:** a reserva atômica de jobs que acabou de ser
implementada (`SELECT ... FOR UPDATE SKIP LOCKED`, correção do bug de mensagem
duplicada de 2026-09-01) é **SQL escrito à mão** — ela vai **passar por cima**
de qualquer filtro automático de cliente. Precisa receber o `clientId`
explicitamente. É a exceção conhecida da estratégia da seção 4.

---

## 4. Estratégia de isolamento

O padrão dos projetos irmãos é filtro manual (`where: { businessId }`)
repetido em cada rota, com um helper central. **Funciona, mas não tem rede de
segurança** — e o histórico deles mostra o custo disso: um IDOR real entre
empresas, só descoberto depois, numa auditoria manual dedicada.

Aqui são **204 queries em 24 arquivos** e o dado é de saúde. Filtro manual em
todas, sem rede, é aposta ruim.

**Abordagem escolhida — contexto de requisição + extensão do Prisma:**

1. Um middleware coloca o `clientId` da sessão num contexto de requisição
   (`AsyncLocalStorage`).
2. Uma extensão do Prisma injeta `where: { clientId }` automaticamente em toda
   query das tabelas isoladas.
3. **Fail-closed:** query numa tabela isolada **sem** contexto de cliente
   lança erro, em vez de devolver o banco inteiro em silêncio. Esquecer o
   filtro vira erro barulhento, não vazamento silencioso.
4. O admin global usa um escape explícito e nomeado (`runAsSuperAdmin(...)`),
   nunca implícito.

**Limites conhecidos dessa abordagem** (documentar e tratar caso a caso):
- SQL cru (`$queryRaw`) **não** passa pela extensão — hoje há um caso
  (a reserva da fila, seção 3.3).
- Queries aninhadas dentro de `include` merecem conferência à parte.
- Webhook e cron **não têm sessão** — abrem contexto explicitamente (o
  webhook, pelo cliente resolvido do `phone_number_id`; o cron, iterando
  cliente a cliente).

---

## 5. Migração do dado real de produção

Regras herdadas dos projetos irmãos, documentadas por eles depois de sustos
reais — valem integralmente aqui:

- **Nunca `prisma migrate dev`.** Ele enxerga a tabela `session` (criada em
  runtime pelo `connect-pg-simple`) como "drift" e oferece **resetar o banco
  de produção**. Migration escrita à mão + `prisma migrate deploy`.
- Type-check não cobre scripts soltos em `scripts/*.ts` — conferir na mão.

**Sequência (aditiva, sem perder nada):**

1. Criar tabelas `clients` e `user_clients`.
2. Criar **um** cliente: `"DGS"` — recipiente de tudo que já existe.
3. Adicionar `clientId` **nullable** em cada tabela isolada.
4. Popular todas com o id do cliente "DGS" (`UPDATE ... SET client_id = 1`).
5. Só então tornar `NOT NULL` e criar os índices.
6. Trocar as constraints de unicidade pelas versões compostas (seção 3.1).
7. Dar acesso de todos os usuários atuais ao cliente "DGS"; marcar o Wesley
   como `isSuperAdmin`.

Nenhuma linha de dado se move ou se perde — cada uma só ganha uma etiqueta.
Ao fim da Fase 0 o sistema se comporta **exatamente** como hoje.

---

## 5b. Ambiente de teste (decidido em 2026-09-01)

O trabalho acontece na branch **`multicliente`** — `master` continua sendo o
que está no ar, intocado.

**Banco local em Docker está descartado**, por decisão do usuário: ele quer
abrir o ambiente de teste **de outros lugares** (celular, outra máquina), e
`localhost` não serve pra isso. O ambiente de teste precisa ser acessível pela
internet:

- **Banco:** um projeto **Supabase separado** (free tier), exclusivo da branch.
  Nunca o banco de produção. É a única forma segura de rodar migration sem
  risco — lembrando que o `.env` desta máquina aponta pro banco **real**.
- **Aplicação:** **deploy de preview da Vercel** a partir da branch
  `multicliente`, com as variáveis de ambiente apontando pro Supabase de teste.
  Isso dá uma URL própria, acessível de qualquer lugar, sem afetar
  `sistema-dgs.vercel.app`.

⚠️ **Primeiro passo da próxima sessão:** criar o projeto Supabase de teste e
configurar as variáveis do preview na Vercel. Enquanto isso não existir,
**nenhuma migration pode ser executada** — não há onde rodar com segurança.

## 6. Fases de execução

Cada fase é entregável e verificável sozinha. O risco sobe até a Fase 2 e cai
depois.

| # | Fase | O que entra | Risco | Como verificar |
|---|---|---|---|---|
| **0** | Schema + migração | Tabelas novas, `clientId` em tudo, constraints compostas, cliente "DGS" populado | **Baixo** — puramente aditivo | Sistema em produção continua idêntico; contagens antes/depois batem |
| **1** | Isolamento no backend | Contexto de requisição, extensão do Prisma, `activeClientId` na sessão | **Médio** — é onde bug se esconde | Teste automatizado com 2 clientes provando que a query de um nunca vê o outro |
| **2** | WhatsApp por cliente | `WhatsappAccount.clientId`, roteamento do webhook por `phone_number_id`, fila e teto por cliente, cron iterando clientes | **Alto** — mexe com mensagem de paciente real | Teste de ponta a ponta com dois números; conferir que resposta cai no cliente certo |
| **3** | Interface | Seletor de cliente no topo, escolha no login quando há mais de um | **Baixo–médio** | Navegador, com dois clientes |
| **4** | Admin global | `/admin`, visão de todos os clientes, gráfico por cliente (reaproveita o de Indicadores), criar cliente, conceder acesso | **Baixo** — aditivo | Navegador |

**Esforço realista:** ~6 a 8 sessões de trabalho. A Fase 2 é a que exige mais
cuidado e provavelmente a que mais rende conversa.

**Ordem importa:** a Fase 0 sozinha já deixa o banco pronto sem mudar
comportamento nenhum — dá pra subir e deixar rodando alguns dias antes de
seguir, o que reduz muito o risco das seguintes.

---

## 7. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Vazamento de dado de saúde entre clientes | **Gravíssimo** (LGPD) | Fail-closed na extensão (seção 4) + teste automatizado de isolamento + auditoria manual das exceções de SQL cru |
| Resposta de paciente atribuída ao cliente errado | Alto | Roteamento por `phone_number_id` (seção 3.2); sem cliente resolvido, não processa |
| Migração corromper dado de produção | Alto | Migração aditiva e reversível; nunca `migrate dev`; backup antes; contagens conferidas antes/depois |
| Cliente ficar sem receber mensagem por causa do teto de outro | Médio | Fila e teto por cliente (seção 3.3) |
| Regressão silenciosa numa das 204 queries | Médio | A extensão do Prisma cobre a maioria por construção; as exceções ficam listadas e revisadas uma a uma |

---

## 8. Estado atual (atualizar a cada fase)

- [~] Fase 0 — Schema + migração. Schema completo (clientId nas 17 tabelas,
      unicidades compostas), migration SQL escrita à mão
      (`20260902000000_multicliente_fase0`). **Falta só**: banco de teste
      (Supabase separado, bloqueio conhecido da seção 5b) pra rodar
      `prisma migrate deploy` de verdade e confirmar as contagens antes/depois.
- [~] Fase 1 — Isolamento no backend. Núcleo pronto e testado sem precisar de
      banco (`src/lib/tenant-context.ts` — AsyncLocalStorage + fail-closed +
      `runAsSuperAdmin`; `src/lib/tenant-prisma-extension.ts` — injeção
      automática de clientId, 14 testes). **Deliberadamente ainda não ligado**
      ao `prisma` exportado de verdade — falta middleware de sessão
      carregando `activeClientId` de `UserClient`, conferir as ~204 queries
      contra os limites conhecidos (SQL cru da fila, includes aninhados), e o
      teste de isolamento com 2 clientes contra banco real (seção 6).
- [ ] Fase 2 — WhatsApp por cliente
- [ ] Fase 3 — Interface / seletor de cliente
- [ ] Fase 4 — Admin global
