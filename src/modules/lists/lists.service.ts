import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/middleware/errorHandler.js";
import { extractList } from "@/modules/extraction/extraction.service.js";
import { mapExtraction, type AppointmentDraft } from "@/modules/extraction/extraction.mapper.js";
import { normalizePhoneList } from "@/lib/phone.js";
import { namesMatch } from "@/lib/text-match.js";
import { recordAudit } from "@/modules/audit/audit.service.js";
import { parseBrasiliaDateTime } from "@/lib/timezone.js";

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
    const unitCheck = await checkUnit(list.agendaId, mapped.executingUnit);
    result.warnings = [...result.warnings, ...unitCheckWarnings(unitCheck)];

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

export interface UnitCheck {
  /** Unidade da agenda vinculada — é dela que sai o endereço na mensagem. */
  agendaUnit: { id: number; name: string; address: string | null } | null;
  /** Unidade que a extração leu no PDF (texto livre, pode não bater com nada cadastrado). */
  pdfUnit: string | null;
  /** Unidade da agenda não tem endereço cadastrado — mensagem sai incompleta. */
  missingAddress: boolean;
  /** PDF leu uma unidade e ela não bate (nem por conter) com a da agenda vinculada. */
  mismatch: boolean;
  /** Lista nem tem agenda vinculada — mensagem sai só com o município. */
  noAgenda: boolean;
}

/**
 * A confirmação de WhatsApp monta o "local" a partir da unidade da agenda
 * vinculada (nome + endereço) — nunca do que a extração lê no arquivo, porque
 * o SISREG não imprime endereço. Compara os dois lados (o que a agenda tem
 * cadastrado vs o que o PDF leu) pra pegar agenda errada ou endereço faltando
 * antes do disparo, em vez de a secretaria receber reclamação de paciente que
 * foi no endereço errado.
 */
export async function checkUnit(agendaId: number | null, executingUnit: string | null): Promise<UnitCheck> {
  if (!agendaId) {
    return { agendaUnit: null, pdfUnit: executingUnit, missingAddress: false, mismatch: false, noAgenda: true };
  }

  const agenda = await prisma.agenda.findUnique({ where: { id: agendaId }, include: { unit: true } });
  if (!agenda?.unit) {
    return { agendaUnit: null, pdfUnit: executingUnit, missingAddress: false, mismatch: false, noAgenda: false };
  }

  return {
    agendaUnit: { id: agenda.unit.id, name: agenda.unit.name, address: agenda.unit.address },
    pdfUnit: executingUnit,
    missingAddress: !agenda.unit.address,
    mismatch: !!executingUnit && !namesMatch(executingUnit, agenda.unit.name),
    noAgenda: false,
  };
}

function unitCheckWarnings(check: UnitCheck): string[] {
  const warnings: string[] = [];
  if (check.noAgenda) {
    warnings.push(
      "Lista sem agenda vinculada: a confirmação vai sair só com o nome do município, sem unidade nem endereço. Vincule uma agenda em Configurações → Agendas."
    );
    return warnings;
  }
  if (!check.agendaUnit) {
    warnings.push(
      "Agenda vinculada não tem unidade cadastrada: a confirmação vai sair sem unidade nem endereço. Ajuste em Configurações → Agendas."
    );
    return warnings;
  }
  if (check.missingAddress) {
    warnings.push(
      `Unidade "${check.agendaUnit.name}" não tem endereço cadastrado: a confirmação vai sair sem endereço. Cadastre em Configurações → Cadastro → Unidades.`
    );
  }
  if (check.mismatch) {
    warnings.push(
      `Unidade lida no arquivo ("${check.pdfUnit}") não bate com a unidade da agenda vinculada ("${check.agendaUnit.name}") — confira se a agenda certa foi escolhida.`
    );
  }
  return warnings;
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
  // Se o CNS bateu num paciente de nome bem diferente, não é seguro nem
  // reaproveitar (pode ser gente diferente) nem levar esse CNS pro paciente
  // novo (violaria o @unique — o CNS já pertence ao outro registro). Some
  // esse dado no rascunho novo em vez de tentar salvar de qualquer jeito.
  let cnsForNewPatient = draft.cns;

  if (draft.cns) {
    const byCns = await tx.patient.findUnique({ where: { cns: draft.cns } });
    // Mesma cautela do telefone (achado em 2026-08-25) também aplicada aqui
    // em 2026-08-26: CNS é forte prova de identidade, mas não é infalível —
    // um bug de alinhamento na extração (já visto no parser SISREG, corrigido
    // separadamente) pode colar o CNS de um registro no nome de outro. Exige
    // nome parecido também antes de acumular telefone num cadastro existente;
    // CNS batendo com nome bem diferente vira paciente novo, sem levar o CNS.
    if (byCns) {
      if (namesMatch(byCns.name, draft.name)) {
        // A lista pode trazer um número novo — acumular, nunca substituir.
        const merged = Array.from(new Set([...byCns.phones, ...draft.phones]));
        return tx.patient.update({ where: { id: byCns.id }, data: { phones: merged } });
      }
      cnsForNewPatient = null;
    }
  }

  if (draft.phones.length > 0) {
    // Telefone sozinho NÃO é prova de identidade — número de celular é
    // reatribuído pela operadora com frequência, e fixo pode ser de outra
    // pessoa da mesma casa. Achado em 2026-08-25: casar só por telefone já
    // tinha misturado o histórico de pessoas de 4 estados diferentes num
    // único cadastro (coincidência de dígito, provavelmente de listas
    // antigas de teste). Exige nome parecido também — telefone batendo com
    // nome completamente diferente vira paciente novo, não reaproveita.
    const candidates = await tx.patient.findMany({ where: { phones: { hasSome: draft.phones } } });
    const byPhone = candidates.find((p) => namesMatch(p.name, draft.name));
    if (byPhone) {
      const merged = Array.from(new Set([...byPhone.phones, ...draft.phones]));
      // cnsForNewPatient já vem null se o CNS do rascunho pertencia a outro
      // paciente (não pode duplicar, é @unique) — só completa o CNS do
      // paciente achado por telefone se ele ainda não tinha nenhum.
      return tx.patient.update({
        where: { id: byPhone.id },
        data: { phones: merged, cns: byPhone.cns ?? cnsForNewPatient },
      });
    }
  }

  return tx.patient.create({
    data: {
      name: draft.name,
      cns: cnsForNewPatient,
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
      scheduledAt: draft.scheduledAt ? parseBrasiliaDateTime(draft.scheduledAt) : new Date(),
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

interface RawLine {
  issues?: string[];
  invalidPhones?: string[];
  notes?: string | null;
  executingUnit?: string | null;
}

/**
 * Tira da lista de avisos (`rawLine.issues`) o que essa edição resolveu —
 * sem isso "telefone inválido"/"sem data" etc. ficam mostrando pra sempre
 * na revisão, mesmo depois de corrigido, porque `rawLine` é um retrato de
 * quando a extração rodou, nunca atualizado depois.
 */
function clearResolvedIssues(rawLine: Prisma.JsonValue, edit: AppointmentEdit): Prisma.InputJsonValue | undefined {
  if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) return undefined;
  const current = rawLine as unknown as RawLine;
  const issues = new Set(current.issues ?? []);
  let invalidPhones = current.invalidPhones ?? [];

  if (edit.selectedPhone) {
    issues.delete("telefone_invalido");
    issues.delete("sem_telefone");
    invalidPhones = [];
  }
  if (edit.scheduledAt) issues.delete("sem_data");
  if (edit.doctorId) issues.delete("sem_medico");
  if (edit.procedureId) issues.delete("sem_procedimento");

  return { ...current, issues: [...issues], invalidPhones } as unknown as Prisma.InputJsonValue;
}

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
        scheduledAt: edit.scheduledAt ? parseBrasiliaDateTime(edit.scheduledAt) : undefined,
        doctorId: edit.doctorId,
        procedureId: edit.procedureId,
        isFirstVisit: edit.isFirstVisit,
        manuallyEdited: true,
        // Corrigido à mão deixa de ser "sem telefone" se ganhou um número.
        status:
          edit.selectedPhone && appointment.status === "SEM_TELEFONE" ? "PENDENTE" : undefined,
        // Sem isso, o aviso ("telefone inválido" etc.) ficava preso pra
        // sempre na revisão mesmo depois de corrigido — rawLine.issues é
        // um retrato de quando a extração rodou, nunca era atualizado.
        rawLine: clearResolvedIssues(appointment.rawLine, edit),
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

  // Se essa linha era metade de um "duplicado" (mesmo paciente aparecendo
  // mais de uma vez na lista — resolvePatient() já resolve as duas linhas
  // pro mesmo patientId), tira o aviso de quem sobrou. Sem isso "duplicado"
  // ficava preso pra sempre em quem já não tem mais duplicata nenhuma
  // (achado pelo usuário em 2026-08-26) — mesma classe do bug já corrigido
  // pros outros avisos em `clearResolvedIssues`, só que esse dispara ao
  // remover, não ao editar.
  const siblings = await prisma.appointment.findMany({
    where: { listId: appointment.listId, patientId: appointment.patientId },
  });
  if (siblings.length === 1) {
    const [sibling] = siblings;
    const rawLine = sibling!.rawLine as RawLine | null;
    if (rawLine?.issues?.includes("duplicado")) {
      await prisma.appointment.update({
        where: { id: sibling!.id },
        data: {
          rawLine: { ...rawLine, issues: rawLine.issues.filter((i) => i !== "duplicado") } as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  await recordAudit({
    userId,
    action: "remove_review",
    entity: "Appointment",
    entityId: appointmentId,
    oldValue: appointment.patientId,
  });
}

export interface RetryFailedUpdate {
  appointmentId: number;
  phone: string;
}

/**
 * Reenvia a confirmação (ou convite de vaga aberta, se a lista for
 * complementar) pra quem falhou, com telefone novo — mesma dinâmica do
 * "Reenviar pra quem falhou" do Cancelamento (2026-08-26). Diferente da
 * edição na revisão (`editAppointment`), não exige a lista estar em
 * `EM_REVISAO`: o objetivo aqui é corrigir DEPOIS do disparo, quando já não
 * dá mais pra editar a linha normalmente.
 */
export async function retryFailedAppointments(
  listId: number,
  updates: RetryFailedUpdate[],
  userId: number
): Promise<{ queued: number }> {
  if (updates.length === 0) throw new AppError("Nenhum telefone informado pra reenviar.", 400);

  const list = await prisma.list.findUnique({ where: { id: listId }, select: { isComplementary: true } });
  if (!list) throw new AppError("Lista não encontrada.", 404);
  const template = list.isComplementary ? "VAGA_ABERTA" : "CONFIRMACAO";

  const appointments = await prisma.appointment.findMany({
    where: { id: { in: updates.map((u) => u.appointmentId) }, listId },
  });
  const byId = new Map(appointments.map((a) => [a.id, a]));

  let queued = 0;
  for (const update of updates) {
    const appointment = byId.get(update.appointmentId);
    if (!appointment) continue; // não pertence a essa lista — ignora em silêncio

    const [normalized] = normalizePhoneList([update.phone]);
    if (!normalized || normalized.kind !== "mobile") {
      throw new AppError(`Telefone inválido pro paciente do agendamento ${update.appointmentId}.`, 400);
    }

    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appointment.id },
        data: { selectedPhone: normalized.e164, status: "PENDENTE" },
      }),
      prisma.messageJob.create({
        data: { appointmentId: appointment.id, template, phone: normalized.e164 },
      }),
    ]);
    queued++;
  }

  await recordAudit({
    userId,
    action: "retry_failed",
    entity: "List",
    entityId: listId,
    metadata: { queued, appointmentIds: updates.map((u) => u.appointmentId) },
  });

  return { queued };
}

/**
 * Aprova a lista. Depois disso a revisão fecha e o disparo é liberado.
 *
 * Quando a unidade/endereço da agenda vinculada não bate com o que o PDF
 * leu (ou está faltando), aprovar exige `confirmUnitMismatch: true` — a
 * equipe precisa ter visto e confirmado o aviso na tela, não só clicado
 * "aprovar" sem reparar. Isso é o que garante que a mensagem de WhatsApp
 * não sai com o endereço de outra unidade do mesmo município.
 */
export async function approveList(
  listId: number,
  userId: number,
  confirmUnitMismatch = false
): Promise<void> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: { _count: { select: { appointments: true } } },
  });
  if (!list) throw new AppError("Lista não encontrada", 404);
  if (list.status !== "EM_REVISAO") throw new AppError("Esta lista não está em revisão.", 409);
  if (list._count.appointments === 0) {
    throw new AppError("A lista está vazia — nada para aprovar.", 400);
  }

  const executingUnit =
    list.extractionRaw && typeof list.extractionRaw === "object" && "executingUnit" in list.extractionRaw
      ? ((list.extractionRaw as { executingUnit?: string | null }).executingUnit ?? null)
      : null;
  const unitCheck = await checkUnit(list.agendaId, executingUnit);
  const hasUnitIssue = unitCheck.noAgenda || !unitCheck.agendaUnit || unitCheck.missingAddress || unitCheck.mismatch;
  if (hasUnitIssue && !confirmUnitMismatch) {
    throw new AppError(
      "A unidade/endereço desta lista têm um aviso pendente — confira o comparativo na tela e confirme antes de aprovar.",
      409
    );
  }

  await prisma.list.update({
    where: { id: listId },
    data: { status: "APROVADA", approvedById: userId, approvedAt: new Date() },
  });
  await recordAudit({ userId, action: "approve", entity: "List", entityId: listId });
}

/**
 * Exclui a lista inteira (arquivo, agendamentos e a fila de mensagens
 * ligada a eles — cascade no banco, ver `onDelete: Cascade` em
 * Appointment/MessageJob). Só antes do disparo: depois de DISPARADA a
 * lista carrega WhatsApp de verdade enviado a pacientes reais — apagar
 * derrubaria histórico e indicadores sem trazer nada de volta. Pra esses
 * casos, "Remover" linha por linha na revisão continua existindo, mas a
 * lista em si fica pra registro.
 */
export async function deleteList(listId: number, userId: number): Promise<void> {
  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) throw new AppError("Lista não encontrada", 404);
  if (list.status === "DISPARADA" || list.status === "CONCLUIDA") {
    throw new AppError(
      "Lista já disparada não pode ser excluída — tem WhatsApp de verdade enviado a pacientes. Remova os agendamentos indevidos um a um, se for o caso.",
      409
    );
  }

  await recordAudit({
    userId,
    action: "delete",
    entity: "List",
    entityId: listId,
    oldValue: `${list.originalName} (${list.status})`,
  });
  await prisma.list.delete({ where: { id: listId } });
}
