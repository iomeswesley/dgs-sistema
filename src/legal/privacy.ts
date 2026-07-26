// Página estática de Política de Privacidade, exigida pela Meta pra
// validar o app do WhatsApp Business. Servida direto pelo Express (fora do
// SPA em React) porque precisa existir sem depender do bundle do frontend.

export const PRIVACY_POLICY_HTML = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de Privacidade — Sistema DGS</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  p, li { color: #333; }
  .updated { color: #777; font-size: 0.9rem; margin-bottom: 2rem; }
  a { color: #0a5cff; }
</style>
</head>
<body>
  <h1>Política de Privacidade — Sistema DGS</h1>
  <p class="updated">Última atualização: 26 de julho de 2026</p>

  <p>
    Esta política descreve como a <strong>D'Artibale Gestão em Saúde (DGS)</strong> trata dados pessoais
    no Sistema DGS, ferramenta interna usada para organizar o agendamento de consultas e exames
    intermediados entre secretarias municipais de saúde e médicos contratados em Santa Catarina.
  </p>

  <h2>Quais dados tratamos</h2>
  <p>Para viabilizar a confirmação de consultas, tratamos:</p>
  <ul>
    <li>Nome do paciente e telefone(s) de contato;</li>
    <li>Número do Cartão Nacional de Saúde (CNS), quando informado pela secretaria;</li>
    <li>Data, horário, procedimento e local da consulta ou exame agendado;</li>
    <li>Histórico de mensagens trocadas via WhatsApp para fins de confirmação e conciliação do
      atendimento (conteúdo da mensagem, status de entrega e respostas).</li>
  </ul>
  <p>
    <strong>Não tratamos dado clínico sensível</strong> — diagnóstico, CID-10 ou qualquer detalhe
    médico nunca são incluídos nas mensagens enviadas nem armazenados fora do necessário para
    identificar o procedimento agendado.
  </p>

  <h2>Para que usamos</h2>
  <p>
    Os dados são usados exclusivamente para confirmar a presença do paciente na consulta agendada
    pela secretaria de saúde do seu município, lembrar da consulta na véspera, e, quando o paciente
    não pode comparecer, oferecer o horário liberado a outro paciente da lista de espera.
  </p>

  <h2>Como enviamos as mensagens</h2>
  <p>
    As confirmações são enviadas pela <strong>API do WhatsApp Business (Meta Platforms, Inc.)</strong>.
    Para extrair os dados das listas de agendamento recebidas em PDF ou foto, e para interpretar
    respostas em texto livre ambíguas, usamos a API da <strong>Anthropic</strong>. Nenhum desses
    provedores usa os dados pra finalidade diferente da prestação do serviço contratado.
  </p>

  <h2>Por quanto tempo guardamos</h2>
  <p>
    O arquivo original da lista e o conteúdo das mensagens trocadas são mantidos por até
    <strong>12 meses</strong> após o recebimento. Depois desse prazo, o conteúdo é apagado
    automaticamente — ficam apenas registros agregados (percentuais de confirmação, comparecimento
    etc.), sem dado pessoal, usados para indicadores de qualidade do serviço.
  </p>

  <h2>Seus direitos</h2>
  <p>
    A qualquer momento, o paciente pode responder <strong>"SAIR"</strong> ou <strong>"PARE"</strong>
    pelo próprio WhatsApp para deixar de receber mensagens — o pedido é atendido de forma definitiva.
    Nos termos da Lei Geral de Proteção de Dados (LGPD), você também pode solicitar acesso,
    correção ou exclusão dos seus dados, ou tirar dúvidas sobre este tratamento, pelo e-mail abaixo.
  </p>

  <h2>Contato</h2>
  <p>
    Dúvidas, solicitações ou pedidos relacionados a este tratamento de dados podem ser enviados
    para <a href="mailto:demotest.mvp@gmail.com">demotest.mvp@gmail.com</a>.
  </p>
</body>
</html>`;
