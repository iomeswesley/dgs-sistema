# Onboarding de cliente novo — sistema de oferta de consultas por WhatsApp

Documento de trabalho (rascunho 2026-10-07). Três partes: **A)** perguntas para o cliente, **B)** o que o cliente precisa saber, **C)** pontos de atenção internos. Itens marcados com **(?)** são o que ainda não foi confirmado com a Meta.

---

## 0. Como o número e o pagamento funcionam hoje

| Modelo | Quem é dono da conta do WhatsApp (WABA) | Quem paga a Meta | Situação |
|---|---|---|---|
| **1. Cliente conecta o próprio número** (o que o sistema faz hoje) | Portfólio do cliente | **Cartão do cliente**, direto na Meta | Funciona. Você cobra só a plataforma. |
| **2. Você hospeda o número na sua conta** | Seu portfólio (Mkt) | **Seu cartão**; você repassa por mensagem | Não implementado; política da Meta **(?)** |
| **3. Linha de crédito (Solution Partner)** | Portfólio do cliente | **Você** (linha de crédito) | Só depois de virar Solution Partner **(?)** — chamado aberto na Meta em 07/10 |

Sobre vender chip: **não é obrigatório**. O que decide quem paga é de quem é a conta do WhatsApp, não o chip. Um chip dedicado só ajuda a ter um **número limpo** (nunca usado em WhatsApp pessoal), o que evita a Coexistência.

Se você configurar o número na SUA conta (modelo 2): o cliente não cadastra cartão, mas o número e a conta ficam no seu portfólio. Ele não consegue levar o número embora facilmente, o nome de exibição precisa ser aprovado pela Meta **(?)**, e a qualidade e o limite de mensagens passam a ser compartilhados entre todos os seus clientes **(?)**. Faça isso só depois de confirmar a política com a Meta.

---

## A) Perguntas para o cliente (enviar antes de configurar)

### A1. Quem é o cliente
1. Razão social, CNPJ e município. É prefeitura, consórcio ou clínica?
2. Quem assina o contrato e quem é o responsável técnico/operacional?
3. Quem é o **encarregado de dados (LGPD)** do órgão?

### A2. Operação
4. Quantos pacientes e quantas agendas por dia? Em quais unidades?
   - **Procedimento:** exame que vai ser realizado (ex.: ultrassonografia)
5. Qual é o horário de atendimento da central e quem acompanha as respostas dos pacientes?
6. Com quanta antecedência querem o lembrete? (hoje é na véspera)
7. O que fazer com paciente que diz que **não tem interesse**? (a vaga fica disponível para reposição)

### A3. Origem das listas
8. De onde vem a lista (ex.: SISREG, CELK, Excel, outro sistema)?
9. Em que formato chega: **PDF nativo** (dá para selecionar o texto), planilha, ou PDF escaneado/foto? (escaneado **não** é lido automaticamente)
10. Pode mandar **2 ou 3 arquivos reais de exemplo** (com dados reais ou fictícios) de dias diferentes?
11. Um mesmo PDF traz mais de um procedimento?
12. O telefone vem completo, com DDD? Há mais de um telefone por paciente?

### A4. WhatsApp
13. Existe um número exclusivo para o WhatsApp da secretaria? Ele já está em uso (pessoal, WhatsApp Business) ou será um chip novo?
14. Quem é administrador do **Facebook** e do **portfólio de negócios (Meta Business)** da prefeitura? Em qual conta de Facebook será feita a conexão?
15. Esse portfólio já passou por **verificação do negócio** na Meta? (aumenta limites e libera o nome de exibição)
16. Quem vai cadastrar o **cartão de pagamento** na conta do WhatsApp na Meta? (ver seção 0)
17. Qual **nome de exibição** deve aparecer para o paciente (ex.: "Secretaria de Saúde de Penha")?

### A5. Segurança e dados
18. Quantos usuários vão usar o sistema? Quem terá acesso?
19. Os pacientes já foram avisados de que receberão mensagem por WhatsApp? Existe base legal/consentimento definido?
20. Qual é a política de retenção dos dados do órgão? (o sistema apaga dados e mídia por prazo configurável)

---

## B) O que o cliente precisa saber

**O que o sistema faz**
- Lê a lista de pacientes e horários, mostra para a equipe conferir e, depois de aprovada, **oferece a consulta/exame** ao paciente por WhatsApp e pergunta se ele **tem interesse**, com os botões **Sim, tenho interesse / Não tenho interesse**. Não é a confirmação de uma consulta que já foi marcada: é uma oferta, e o paciente decide se quer.
- Envia lembrete na véspera para quem tem interesse, com a orientação de levar documentos e **conferir o preparo na guia do exame**.
- Quem não tem interesse libera a vaga, e a equipe vê tudo em Acompanhamento. Também é possível cancelar a agenda inteira e avisar todos.
- A equipe pode conversar com o paciente em Conversas dentro da janela de 24h.

**O que o sistema NÃO faz**
- Não lê **PDF escaneado ou foto**. Precisa de PDF nativo ou do modelo Excel.
- Não decide nada sozinho: toda lista passa pela revisão da equipe antes de qualquer envio.
- Não envia CID nem dados clínicos na mensagem.

**Formato das listas aceitas**
- PDF nativo do **SISREG**, do **CELK**, ou de um relatório de **uma linha por paciente**.
- **Planilha Excel** no modelo padrão (botão "Baixar modelo Excel" em Listas), com menus do cadastro dele. Regras principais: Município só com o nome (sem "-SC"), datas em DD/MM/AAAA, horário HH:MM, telefone com DDD.
- A lista precisa ter: **nome, telefone (com DDD), data e horário, procedimento e unidade**.

**Sobre o WhatsApp (Meta)**
- O WhatsApp é cobrado pela **Meta**, não por nós. Hoje o cliente cadastra o **cartão** na conta do WhatsApp dele.
- Sem cartão, **nenhuma mensagem é entregue**, mesmo que o sistema mostre "enviada".
- Conta nova começa com **limite de 250 mensagens por dia**, que cresce com o uso e a qualidade.
- Os **modelos de mensagem** (templates) são aprovados pela Meta (de horas a poucos dias). Sem aprovação, não há envio.
- A **qualidade** do número depende de não mandar para quem não quer receber. Quem pedir para sair deve ser respeitado.
- A Meta pode mudar regras e preços. A partir de **outubro/2026**, mensagens livres fora da janela de 24h também passam a ser cobradas.

**Responsabilidades do cliente**
- Revisar a lista antes de aprovar e dispará-la só quando o número ativo estiver certo.
- Manter o cadastro (unidades, médicos, procedimentos) correto, incluindo o **endereço** que vai na mensagem.
- Tratar os dados dos pacientes conforme a LGPD. Nós somos operadores; o órgão é o controlador.

---

## C) Pontos de atenção para você (interno)

### Antes de ativar um cliente
1. **Pagamento:** confira que a conta consegue enviar. Pela Graph API, `health_status.can_send_message` deve ser `AVAILABLE`. **O "Enviar teste" engana**: aceita e só depois a Meta recusa (erro 131042). Confirme que a mensagem **chegou no celular**.
2. **Número ativo:** nunca deixe um número sem pagamento como ativo. Foi o que causou as 188 falhas de 06/10.
3. **Teto diário:** ao ativar um número novo, ajuste `WHATSAPP_DAILY_LIMIT` para **250**. O sistema não lê o limite real da Meta.
4. **Templates:** confira que os 6 estão **APPROVED** na conta nova antes do primeiro disparo.
5. **Cadastro:** cliente novo começa vazio. Cadastre municípios, unidades com endereço, médicos e procedimentos (com a instrução de preparo).
6. **Cobrança:** configure em `/admin` o limite de mensagens (janela ou créditos) do cliente.
7. **Business Verification** do portfólio dele: sem ela, o portfólio fica `LIMITED`.
8. **Portfólios do Facebook:** cada pessoa só pode **criar 2**. Se o cliente já criou 2, ele precisa escolher um existente ou ser adicionado como administrador.

### Primeiro uso
9. Suba **2 listas reais de teste** (ou use o "Enviar teste") para números da equipe antes de qualquer paciente.
10. Confira na Revisão: unidade e endereço, procedimento por paciente, telefones inválidos e duplicados.
11. Acompanhe o primeiro dia com o **"status hoje"**: falhas, respostas não classificadas, fila travada.

### Riscos conhecidos
- **PDF com vários procedimentos** no mesmo arquivo: já corrigido para o CELK. Para outros formatos, **valide** com um exemplo real.
- **Falha total de envio** não reenvia sozinha: use "Reenviar pra quem falhou" em cada lista.
- **Mensagem com procedimento errado** não tem template de correção; avisar por telefone.
- **PDF escaneado** não é lido; precisa de transcrição manual (decisão de não usar IA na extração).
- **Dados de saúde:** nunca coloque dado de paciente em log, URL ou chamado externo. Para a Meta, mande só dados fictícios ou do negócio.
- **Termos da Meta (Partnership Home):** você assumiu indenização à Meta e cedeu licença sobre os dados que enviar a ela. Não envie dados de paciente.
- **Business Verification** e **nome de exibição**: o nome do número atual (+55 47 9750-5750) aparece como `DECLINED` na Meta.
- **Coexistência** (número que já usa WhatsApp Business App): conectou em 05/10 com outro Facebook, mas ainda precisa de um teste com Facebook sem papel no app.

### Como validar o formato que a secretaria envia
1. Peça o arquivo real (PDF ou Excel).
2. Rode o leitor (`extractList`) nele e confira, linha por linha: nome, telefone, data/hora, procedimento, médico, unidade. O que não bater vira correção de parser ou orientação ao cliente (como no caso Timbó e no caso Penha).
3. Se for planilha com layout próprio, o cliente copia para o **modelo Excel padrão** (colunas e formatos já definidos).
4. Só depois cadastre a agenda e dispare para os números da equipe.

### Pendência: textos de WhatsApp da "oferta de consulta"
- Hoje os templates aprovados ainda falam em **confirmação de consulta marcada**: `confirmacao_consulta` ("Você tem uma consulta marcada… Podemos confirmar sua presença?", botões "Sim, vou comparecer" / "Não poderei ir"). O texto da oferta ("Sim, tenho interesse" / "Não tenho interesse") **ainda não existe**; o mais próximo é `convite_vaga_aberta` ("Abriu uma vaga… Você tem interesse nesse horário?", botões "Sim, quero a vaga" / "Não, obrigado").
- Mudar isso exige **template novo aprovado pela Meta** (cerca de 1 dia) e ajustar o reconhecimento das respostas (`classifyReply`). Este documento já descreve o fluxo como oferta; a mensagem de verdade só muda depois disso.

### Decisões comerciais ainda em aberto
- Modelo de cobrança: cliente paga a Meta direto (modelo 1) × você paga e repassa (modelos 2 e 3).
- Resposta da Meta sobre **Solution Partner / linha de crédito** (chamado enviado em 07/10).
- Preço da plataforma por cliente e política de excedente.
