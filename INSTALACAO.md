# Instalação — Sistema DGS

Passo a passo do que fazer quando as credenciais existirem. Tudo o que é código já está pronto; o que falta aqui é conta, chave e o primeiro `deploy`.

## 1. Banco (Supabase)

1. Criar um projeto **novo e dedicado** no Supabase (não reaproveitar o de outro sistema).
2. Em Project Settings → Database, copiar as duas strings de conexão para o `.env`:
   - `DATABASE_URL` — a do **pooler em modo transaction** (porta `6543`), com `?pgbouncer=true`
   - `DIRECT_URL` — a **conexão direta** (porta `5432`)
3. Criar as tabelas:

```bash
npx prisma migrate deploy
```

> **Nunca rodar `prisma migrate dev`.** A tabela `session` é criada em tempo de execução pelo `connect-pg-simple`, fora do controle do Prisma. O `migrate dev` enxerga isso como "drift" e oferece **resetar o banco inteiro**. Migrations novas se escrevem à mão, copiando o padrão de `prisma/migrations/*/migration.sql`, e se aplicam com `migrate deploy`.

4. Gerar o segredo de sessão e colar em `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

5. Criar o primeiro usuário (a senha é gerada e mostrada uma vez só):

```bash
npm run seed -- "Seu Nome" seu.email@dgs.com.br
```

## 2. Extração das listas (Anthropic)

Colar a chave em `ANTHROPIC_API_KEY`. Sem ela o upload continua funcionando, mas a lista entra direto em revisão vazia, para preenchimento manual.

Para conferir a leitura em um arquivo antes de subir qualquer coisa:

```bash
npm run extrair -- caminho/da/lista.pdf
```

## 3. WhatsApp (Meta)

### 3.1 Conta e número

No Meta Business Manager, criar o app do WhatsApp e anotar:

| Variável | Onde fica |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Token do app |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Manager, no número |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | O WABA ID |
| `WHATSAPP_APP_SECRET` | Configurações do app → Básico |
| `WHATSAPP_VERIFY_TOKEN` | Inventado por você; precisa bater com o passo 3.3 |

> O token de **envio** usa a permissão `whatsapp_business_messaging`. Para **criar templates** é preciso `whatsapp_business_management` — são permissões diferentes, e essa é a causa mais comum de erro no passo seguinte.

### 3.2 Templates

```bash
npm run templates
```

Submete os três templates. Acompanhar a aprovação em WhatsApp Manager → Modelos de mensagem. O texto está em [TEMPLATES-WHATSAPP.md](TEMPLATES-WHATSAPP.md).

### 3.3 Webhook

No app da Meta, em WhatsApp → Configuração, apontar o webhook para:

```
https://SEU-DOMINIO/api/whatsapp/webhook
```

Usar o mesmo valor de `WHATSAPP_VERIFY_TOKEN` no campo de verificação, e assinar os campos **`messages`** (respostas dos pacientes) e **`message_status`** (entrega e falha — sem isso o sistema não sabe que a mensagem não chegou).

### 3.4 Templates adicionais da Fase 2

`lembrete_vespera` e `convite_vaga_aberta` (o segundo usado nas listas complementares) fazem parte do mesmo lote submetido por `npm run templates` — não precisam de passo separado.

### 3.5 Limite diário

`WHATSAPP_DAILY_LIMIT` precisa espelhar o tier atual do número na Meta (um número novo começa em ~250 conversas/24h). A fila para ao bater esse teto e informa quanto sobrou, em vez de insistir e derrubar a qualidade do número. Conforme a Meta elevar o tier, aumentar o valor aqui.

## 4. Deploy (Vercel)

1. Criar o projeto apontando para este repositório.
2. Copiar todas as variáveis do `.env` para as Environment Variables do projeto.
3. Definir `CRON_SECRET` (qualquer valor aleatório) — o Vercel usa para autenticar o cron que processa a fila de hora em hora.
4. Após o push, se o site continuar servindo a versão antiga: Deployments → **Promote to Production**.
5. O projeto usa **dois crons** (fila a cada hora + resumo diário às 18h de Brasília). No plano **Hobby** da Vercel, cron só roda no máximo uma vez por dia — o cron horário da fila não vai disparar como configurado. Para o disparo em massa funcionar de verdade (não só o botão manual "processar agora" no painel), o projeto precisa estar no plano **Pro**.

## 5. E-mail (Resend) — opcional, mas necessário para relatório automático

Colar a chave em `RESEND_API_KEY` e configurar `EMAIL_FROM` com um domínio verificado no Resend. Sem isso:
- O relatório da lista ao "Concluir" não sai por e-mail (mas continua disponível para baixar manualmente).
- O resumo diário para o gestor não é enviado.

## 6. Primeira operação

Na ordem, pelo painel:

1. **Configurações** → cadastrar município, unidade (com endereço, que vai na mensagem), médico e procedimento.
2. **Configurações → Procedimentos por médico** → tempo por consulta, esperado/dia e os dois valores. Sem os valores, o fechamento não calcula repasse nem margem.
3. **Listas** → enviar o PDF ou a foto da agenda.
4. Abrir a lista → conferir as linhas destacadas ao lado do arquivo original → **Aprovar**.
5. **Disparar confirmações** → as mensagens entram na fila e saem respeitando o limite do dia.
6. **Acompanhamento** → ver as respostas chegando; registrar contato de quem foi por telefone.
7. **Fechamento** → lançar atendidos (check 2) e guias (check 3).
8. **Indicadores** → as taxas e o financeiro, com export para Excel.

## Checklist rápido

- [ ] Projeto Supabase criado, `DATABASE_URL` e `DIRECT_URL` no `.env`
- [ ] `npx prisma migrate deploy` rodado
- [ ] `SESSION_SECRET` gerado
- [ ] Primeiro usuário criado com `npm run seed`
- [ ] `ANTHROPIC_API_KEY` configurada (extração **e** classificação de respostas ambíguas)
- [ ] Conta do WhatsApp Business criada e as 5 variáveis preenchidas
- [ ] Templates submetidos e **aprovados** pela Meta (3 da Fase 1 + `lembrete_vespera` e `convite_vaga_aberta`)
- [ ] Webhook cadastrado com `messages` e `message_status` assinados
- [ ] `WHATSAPP_DAILY_LIMIT` conferido com o tier do número
- [ ] `RESEND_API_KEY` e `EMAIL_FROM` configurados (relatório automático e resumo diário)
- [ ] Projeto no Vercel com as variáveis e o `CRON_SECRET`
- [ ] Plano **Pro** na Vercel (Hobby não roda cron mais de uma vez por dia — a fila precisa do cron horário)
