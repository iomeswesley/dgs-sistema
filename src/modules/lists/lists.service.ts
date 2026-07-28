import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { extractList } from "@/modules/extraction/extraction.service.js";
import { mapExtraction, type AppointmentDraft } from "@/modules/extraction/extraction.mapper.js";
import { normalizePhoneList } from "@/lib/phone.js";
import { recordAudit } from "@/modules/audit/audit.service.js";

/*
  Ciclo de vida de uma lista:

    EXTRAINDO → EM_REVISAO → APROVADA → DISPARADA → CONCLUIDA
                     ↑ ERRO

  A revisão é obrigatória entre a extração e o disparo. Nenhum caminho aqui
  pula essa etapa — é a regra que impede mensagem sair com dado não conferido.
*/

/**
 * Roda a extração e grava os agendamentos como rascunho.
 *
 * Erro de extração não perde o arquivo: a lista fica em ERRO com a mensagem,
 * e dá pra reprocessar ou preencher à mão.
 */
export async function extractAndStage(listId: number): Promise<void> {
  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) throw new AppError("Lista não encontrada", 404);

  try {
    const { result } = await extractList(Buffer.from(list.fileData), list.mimeType);
    const mapped = mapExtraction(result);

    await prisma.$transaction(
      async (tx) => {
        // Reprocessamento apaga os rascunhos anteriores — só é permitido
        // antes da aprovação, então não há mensagem enviada pra perder.
        await tx.appointment.deleteMany({ where: { listId } });

        for (const draft of mapped.drafts) {
          await createAppointmentFromDraft(tx, listId, list.municipalityId, list.agendaId, draft, mapped);
        }

        await tx.list.update({
          where: { id: listId },
          data: {
            status: "EM_REVISAO",
            sourceFormat: mapped.sourceFormat,
            extractionRaw: result as unknown as Prisma.InputJsonValue,
            extractionError: null,
            extractedAt: new Date(),
          },
        });
      },
      // Padrão do Prisma é 5s — uma lista grande faz várias queries por
      // linha (resolver médico/procedimento/unidade/paciente), então o
      // padrão estoura fácil. 60s dá folga pra listas de centenas de linhas.
      { maxWait: 10_000, timeout: 60_000 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha desconhecida na extração";
    await prisma.list.update({
      where: { id: listId },
      data: { status: "ERRO", extractionError: message },
    });
    throw err;
  }
}

type TxClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/** Resolve nome de médico/procedimento/unidade em cadastro, criando se preciso. */
async function resolveCatalog(
  tx: TxClient,
  municipalityId: number,
  draft: AppointmentDraft
): Promise<{ doctorId: number; procedureId: number; requestingUnitId: number | null }> {
  // A lista traz nomes livres; o cadastro precisa de ids. Criar na hora evita
  // travar a extração por cadastro faltando — a equipe ajusta depois em
  // Configurações, e o vínculo já fica feito.
  const doctorName = (draft.doctor ?? "Não informado").trim();
  const doctor =
    (await tx.doctor.findFirst({ where: { name: { equals: doctorName, mode: "insensitive" } } })) ??
    (await tx.doctor.create({ data: { name: doctorName } }));

  const procedureName = (draft.procedure ?? "Não informado").trim();
  const procedure =
    (await tx.procedure.findFirst({ where: { name: { equals: procedureName, mode: "insensitive" } } })) ??
    (await tx.procedure.create({ data: { name: procedureName } }));

  let requestingUnitId: number | null = null;
  if (draft.requestingUnit) {
    const unitName = draft.requestingUnit.trim();
    const unit =
      (await tx.healthUnit.findFirst({
        where: { municipalityId, name: { equals: unitName, mode: "insensitive" } },
      })) ?? (await tx.healthUnit.create({ data: { municipalityId, name: unitName } }));
    requestingUnitId = unit.id;
  }

  return { doctorId: doctor.id, procedureId: procedure.id, requestingUnitId };
}

/** Encontra ou cria o paciente, deduplicando por CNS e depois por telefone. */
async function resolvePatient(tx: TxClient, draft: AppointmentDraft) {
  if (draft.cns) {
    const byCns = await tx.patient.findUnique({ where: { cns: draft.cns } });
    if (byCns) {
      // A lista pode trazer um número novo — acumular, nunca substituir.
      const merged = Array.from(new Set([...byCns.phones, ...draft.phones]));
      return tx.patient.update({ where: { id: byCns.id }, data: { phones: merged } });
    }
  }

  if (draft.phones.length > 0) {
    const byPhone = await tx.patient.findFirst({ where: { phones: { hasSome: draft.phones } } });
    if (byPhone) {
      const merged = Array.from(new Set([...byPhone.phones, ...draft.phones]));
      return tx.patient.update({
        where: { id: byPhone.id },
        data: { phones: merged, cns: byPhone.cns ?? draft.cns },
      });
    }
  }

  return tx.patient.create({
    data: {
      name: draft.name,
      cns: draft.cns,
      birthDate: draft.birthDate ? new Date(draft.birthDate) : null,
      phones: draft.phones,
    },
  });
}

async function createAppointmentFromDraft(
  tx: TxClient,
  listId: number,
  municipalityId: number,
  agendaId: number | null,
  draft: AppointmentDraft,
  mapped: ReturnType<typeof mapExtraction>
) {
  const { doctorId, procedureId, requestingUnitId } = await resolveCatalog(tx, municipalityId, draft);
  const patient = await resolvePatient(tx, draft);

  return tx.appointment.create({
    data: {
      listId,
      agendaId,
      patientId: patient.id,
      municipalityId,
      doctorId,
      procedureId,
      requestingUnitId,
      scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt) : new Date(),
      isFirstVisit: draft.isFirstVisit,
      phones: draft.phones,
      selectedPhone: draft.dispatchPhone,
      // Paciente sem celular já nasce como não contatável: ele continua no
      // relatório devolvido à secretaria, mas nunca entra na fila de envio.
      status: draft.dispatchPhone ? "PENDENTE" : "SEM_TELEFONE",
      extractionConfidence: draft.confidence,
      rawLine: {
        issues: draft.issues,
        invalidPhones: draft.invalidPhones,
        notes: draft.notes,
        executingUnit: mapped.executingUnit,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

const editableFields = [
  "patientName",
  "selectedPhone",
  "scheduledAt",
  "doctorId",
  "procedureId",
  "isFirstVisit",
] as const;

export interface AppointmentEdit {
  patientName?: string;
  selectedPhone?: string | null;
  scheduledAt?: string;
  doctorId?: number;
  procedureId?: number;
  isFirstVisit?: boolean | null;
}

/** Correção manual de uma linha na revisão. Só antes do disparo. */
export async function editAppointment(
  appointmentId: number,
  edit: AppointmentEdit,
  userId: number
): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { list: true, patient: true },
  });
  if (!appointment) throw new AppError("Agendamento não encontrado", 404);
  if (appointment.list.status !== "EM_REVISAO") {
    throw new AppError("Esta lista não está mais em revisão.", 409);
  }

  if (edit.selectedPhone !== undefined && edit.selectedPhone !== null) {
    const [normalized] = normalizePhoneList([edit.selectedPhone]);
    if (!normalized) throw new AppError("Telefone inválido", 400);
    if (normalized.kind !== "mobile") throw new AppError("Só celular recebe WhatsApp.", 400);
    edit.selectedPhone = normalized.e164;
  }

  await prisma.$transaction(async (tx) => {
    if (edit.patientName) {
      await tx.patient.update({ where: { id: appointment.patientId }, data: { name: edit.patientName } });
    }

    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        selectedPhone: edit.selectedPhone,
        scheduledAt: edit.scheduledAt ? new Date(edit.scheduledAt) : undefined,
        doctorId: edit.doctorId,
        procedureId: edit.procedureId,
        isFirstVisit: edit.isFirstVisit,
        manuallyEdited: true,
        // Corrigido à mão deixa de ser "sem telefone" se ganhou um número.
        status:
          edit.selectedPhone && appointment.status === "SEM_TELEFONE" ? "PENDENTE" : undefined,
      },
    });
  });

  for (const field of editableFields) {
    const value = edit[field as keyof AppointmentEdit];
    if (value === undefined) continue;
    await recordAudit({
      userId,
      action: "edit_review",
      entity: "Appointment",
      entityId: appointmentId,
      field,
      newValue: value,
    });
  }
}

/** Remove uma linha na revisão (duplicata, paciente que não é daquela agenda). */
export async function removeAppointment(appointmentId: number, userId: number): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { list: true },
  });
  if (!appointment) throw new AppError("Agendamento não encontrado", 404);
  if (appointment.list.status !== "EM_REVISAO") {
    throw new AppError("Esta lista não está mais em revisão.", 409);
  }

  await prisma.appointment.delete({ where: { id: appointmentId } });
  await recordAudit({
    userId,
    action: "remove_review",
    entity: "Appointment",
    entityId: appointmentId,
    oldValue: appointment.patientId,
  });
}

/** Aprova a lista. Depois disso a revisão fecha e o disparo é liberado. */
export async function approveList(listId: number, userId: number): Promise<void> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: { _count: { select: { appointments: true } } },
  });
  if (!list) throw new AppError("Lista não encontrada", 404);
  if (list.status !== "EM_REVISAO") throw new AppError("Esta lista não está em revisão.", 409);
  if (list._count.appointments === 0) {
    throw new AppError("A lista está vazia — nada para aprovar.", 400);
  }

  await prisma.list.update({
    where: { id: listId },
    data: { status: "APROVADA", approvedById: userId, approvedAt: new Date() },
  });
  await recordAudit({ userId, action: "approve", entity: "List", entityId: listId });
}
