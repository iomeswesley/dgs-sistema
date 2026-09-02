import { prisma } from "@/lib/prisma.js";
import { requireActiveClientId } from "@/lib/tenant-context.js";
import { getSettings } from "@/modules/settings/settings.service.js";

/*
  Cadência das mensagens:

    D-2  confirmação          (enfileirada no disparo da lista)
    D-1  lembrete             → só quem confirmou, com o preparo do exame
    ---  reenvio              → quem não respondeu, pelo telefone alternativo

  Tudo passa pela mesma fila, que respeita o teto diário. Estas funções só
  criam jobs; quem envia é o processador.

  Regra que atravessa as três: nunca dois envios para o mesmo paciente no
  mesmo dia. É a diferença entre lembrar e importunar — e paciente
  importunado bloqueia o número.
*/

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Já saiu (ou está prestes a sair) alguma mensagem hoje para este agendamento? */
async function alreadyTouchedToday(appointmentId: number, phone: string): Promise<boolean> {
  const today = startOfDay(new Date());

  const [sent, queued] = await Promise.all([
    prisma.whatsappMessage.count({
      where: { appointmentId, phone, direction: "ENVIADA", createdAt: { gte: today } },
    }),
    prisma.messageJob.count({
      where: { appointmentId, phone, status: { in: ["PENDENTE", "ENVIANDO"] } },
    }),
  ]);

  return sent > 0 || queued > 0;
}

export interface CadenceResult {
  queued: number;
  skipped: number;
}

/**
 * Lembrete da véspera para quem confirmou.
 *
 * Leva o preparo do exame, que é o que evita o paciente comparecer e não
 * poder fazer o procedimento (jejum, bexiga cheia). O botão "não poderei
 * mais ir" captura a desistência com 24h de antecedência — tempo de a
 * secretaria repor a vaga.
 */
export async function enqueueReminders(): Promise<CadenceResult> {
  const tomorrow = startOfDay(new Date());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: "CONFIRMADO",
      scheduledAt: { gte: tomorrow, lt: dayAfter },
      selectedPhone: { not: null },
      patient: { optedOut: false },
    },
    select: { id: true, selectedPhone: true },
  });

  let queued = 0;
  let skipped = 0;

  for (const appointment of appointments) {
    const phone = appointment.selectedPhone!;

    const alreadyReminded = await prisma.messageJob.count({
      where: { appointmentId: appointment.id, template: "LEMBRETE" },
    });
    if (alreadyReminded > 0 || (await alreadyTouchedToday(appointment.id, phone))) {
      skipped++;
      continue;
    }

    await prisma.messageJob.create({
      data: { clientId: requireActiveClientId(), appointmentId: appointment.id, template: "LEMBRETE", phone },
    });
    queued++;
  }

  return { queued, skipped };
}

/** Horas sem resposta antes de tentar de novo. */
const RETRY_AFTER_HOURS = 24;

/**
 * Reenvia a confirmação para quem não respondeu, **pelo próximo telefone**.
 *
 * Repetir no mesmo número que já falhou não resolve nada e ainda consome o
 * limite do dia. Quando não há telefone alternativo, o agendamento fica para
 * contato manual da equipe em vez de gerar envio inútil.
 */
export async function enqueueRetries(): Promise<CadenceResult> {
  const cutoff = new Date(Date.now() - RETRY_AFTER_HOURS * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: { in: ["ENVIADO", "ENTREGUE", "FALHA"] },
      // Só faz sentido insistir enquanto a consulta ainda não passou.
      scheduledAt: { gt: new Date() },
      patient: { optedOut: false },
      messages: { some: { direction: "ENVIADA", createdAt: { lt: cutoff } } },
    },
    select: { id: true, phones: true, selectedPhone: true },
  });

  let queued = 0;
  let skipped = 0;

  for (const appointment of appointments) {
    const tried = await prisma.whatsappMessage.findMany({
      where: { appointmentId: appointment.id, direction: "ENVIADA" },
      select: { phone: true },
    });
    const triedPhones = new Set(tried.map((message) => message.phone));

    const nextPhone = appointment.phones.find((phone) => !triedPhones.has(phone));
    if (!nextPhone || (await alreadyTouchedToday(appointment.id, nextPhone))) {
      skipped++;
      continue;
    }

    await prisma.messageJob.create({
      data: {
        clientId: requireActiveClientId(),
        appointmentId: appointment.id,
        template: "CONFIRMACAO",
        phone: nextPhone,
      },
    });
    queued++;
  }

  return { queued, skipped };
}

/*
  Expurgo LGPD.

  Dado de saúde é dado sensível: nome, CNS e procedimento não podem ficar
  guardados indefinidamente. Depois do prazo, o arquivo original e o conteúdo
  das mensagens são apagados, e os agregados que alimentam os indicadores
  ficam — histórico de percentual não precisa de dado pessoal.
*/

/** Meses de retenção do arquivo original e do conteúdo das mensagens. */
const RETENTION_MONTHS = 12;

export interface PurgeResult {
  listsPurged: number;
  messagesPurged: number;
}

export async function purgeExpiredData(): Promise<PurgeResult> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  // O arquivo (bytes) sai; a lista permanece, para os indicadores e para
  // saber que ela existiu.
  const expiredLists = await prisma.list.findMany({
    where: { createdAt: { lt: cutoff }, sizeBytes: { not: null } },
    select: { id: true },
  });

  for (const list of expiredLists) {
    await prisma.list.update({
      where: { id: list.id },
      data: { fileData: Buffer.alloc(0), sizeBytes: null, extractionRaw: undefined },
    });
  }

  // Conteúdo das mensagens sai; o registro de entrega fica, porque é o que
  // sustenta o indicador de qualidade da lista.
  const messages = await prisma.whatsappMessage.updateMany({
    where: { createdAt: { lt: cutoff }, OR: [{ body: { not: null } }, { raw: { not: undefined } }] },
    data: { body: null, raw: undefined },
  });

  return { listsPurged: expiredLists.length, messagesPurged: messages.count };
}

/**
 * Expurgo da mídia recebida do paciente (imagem, áudio, figurinha,
 * documento — ver `WhatsappMessage.mediaData`), separado do expurgo geral
 * acima porque a retenção é bem mais curta e configurável pela equipe
 * (Configurações → WhatsApp → `AppSettings.mediaRetentionDays`, default 30
 * dias) em vez de fixa em 12 meses. A descrição textual (`body`, tipo "📷
 * Imagem: minha receita") continua — só o arquivo em si sai.
 */
export async function purgeExpiredMedia(): Promise<number> {
  const { mediaRetentionDays } = await getSettings();
  const cutoff = new Date(Date.now() - mediaRetentionDays * 24 * 60 * 60 * 1000);

  const result = await prisma.whatsappMessage.updateMany({
    where: { createdAt: { lt: cutoff }, mediaData: { not: null } },
    data: { mediaData: null, mediaMimeType: null, mediaFilename: null },
  });
  return result.count;
}
