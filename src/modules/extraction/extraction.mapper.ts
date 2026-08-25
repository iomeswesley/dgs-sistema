import { normalizePhoneList, pickDispatchPhone } from "@/lib/phone.js";
import { namesMatch } from "@/lib/text-match.js";
import type { ExtractedRow, ExtractionResult } from "./extraction.schema.js";

/*
  Ponte entre o que a IA leu e o que a equipe revisa.

  Aqui não há chamada de rede nem banco — só a transformação, para que a
  regra que decide quem recebe mensagem seja testável de ponta a ponta.
*/

/** Abaixo disso a linha aparece destacada na revisão. */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

export type DraftIssue =
  | "sem_telefone"
  | "telefone_invalido"
  | "baixa_confianca"
  | "sem_data"
  | "sem_procedimento"
  | "sem_medico"
  | "duplicado";

export interface AppointmentDraft {
  /** Posição na lista original, para casar com o arquivo na revisão. */
  index: number;
  name: string;
  cns: string | null;
  birthDate: string | null;
  /** Telefones válidos em E.164, celulares primeiro. */
  phones: string[];
  /** Telefones que a lista trazia mas não são discáveis. */
  invalidPhones: string[];
  /** Número escolhido para o disparo; null quando não há celular. */
  dispatchPhone: string | null;
  procedure: string | null;
  doctor: string | null;
  scheduledAt: string | null;
  requestingUnit: string | null;
  isFirstVisit: boolean | null;
  confidence: number;
  notes: string | null;
  /** O que precisa de atenção humana antes do disparo. */
  issues: DraftIssue[];
  /** true quando nada impede o envio. */
  readyToSend: boolean;
}

export interface MappedList {
  sourceFormat: ExtractionResult["sourceFormat"];
  municipality: string | null;
  executingUnit: string | null;
  doctor: string | null;
  procedure: string | null;
  warnings: string[];
  drafts: AppointmentDraft[];
  summary: {
    total: number;
    readyToSend: number;
    needsReview: number;
    withoutPhone: number;
  };
}

/** Identidade para detectar a mesma pessoa duas vezes na mesma lista. */
function identityKey(draft: AppointmentDraft): string {
  if (draft.cns) return `cns:${draft.cns.replace(/\D/g, "")}`;
  const phone = draft.phones[0];
  if (phone) return `phone:${phone}`;
  return `name:${draft.name.trim().toLowerCase()}|${draft.scheduledAt ?? ""}`;
}

function mapRow(row: ExtractedRow, index: number, header: ExtractionResult): AppointmentDraft {
  const normalized = normalizePhoneList(row.phones);
  const phones = normalized.map((phone) => phone.e164);

  // Guardar o que foi descartado importa: "telefone errado na lista" é um
  // indicador de qualidade devolvido à secretaria, não lixo a esconder.
  const invalidPhones = row.phones.filter((raw) => {
    const digits = String(raw).replace(/\D/g, "");
    return digits.length > 0 && !normalized.some((phone) => phone.e164.endsWith(digits.slice(-8)));
  });

  const dispatchPhone = pickDispatchPhone(row.phones);
  // Cabeçalho preenche o que a linha não traz — no CELK o procedimento vem
  // da seção, no SISREG o médico vem do topo.
  const procedure = row.procedure ?? header.procedure;
  const doctor = row.doctor ?? header.doctor;

  const issues: DraftIssue[] = [];
  if (phones.length === 0) issues.push("sem_telefone");
  else if (!dispatchPhone) issues.push("telefone_invalido"); // só fixo: não recebe WhatsApp
  if (invalidPhones.length > 0 && !issues.includes("telefone_invalido")) issues.push("telefone_invalido");
  if (row.confidence < LOW_CONFIDENCE_THRESHOLD) issues.push("baixa_confianca");
  if (!row.scheduledAt) issues.push("sem_data");
  if (!procedure) issues.push("sem_procedimento");
  if (!doctor) issues.push("sem_medico");

  return {
    index,
    name: row.name.trim(),
    cns: row.cns,
    birthDate: row.birthDate,
    phones,
    invalidPhones,
    dispatchPhone,
    procedure,
    doctor,
    scheduledAt: row.scheduledAt,
    requestingUnit: row.requestingUnit,
    isFirstVisit: row.isFirstVisit,
    confidence: row.confidence,
    notes: row.notes,
    issues,
    readyToSend: issues.length === 0,
  };
}

/**
 * Converte o resultado da extração em rascunhos de agendamento, já com os
 * telefones normalizados e os problemas apontados.
 *
 * Nada aqui descarta linha: paciente sem telefone continua na lista, marcado
 * como não contatável, porque isso volta no relatório para a secretaria.
 */
export function mapExtraction(extraction: ExtractionResult): MappedList {
  const drafts = extraction.rows.map((row, index) => mapRow(row, index, extraction));

  // Duplicidade é comum nessas listas (dois procedimentos no mesmo dia, ou
  // erro da prefeitura). Marca as ocorrências e deixa a equipe decidir —
  // apagar automaticamente poderia cancelar um atendimento legítimo.
  //
  // `identityKey()` sozinho não basta: quando não há CNS, ele cai pro
  // telefone, e telefone igual não significa a mesma pessoa — é comum
  // duas pessoas da mesma casa (família) compartilharem um número. Achado
  // pelo usuário em 2026-08-27, mesmo motivo que já tinha corrigido
  // `resolvePatient()` em 25/08 (não juntar pacientes só por telefone
  // batendo): sem o nome bater também, marcar "duplicado" aqui confundia
  // duas pessoas de verdade diferentes como se fossem uma só duplicada —
  // cada uma virava paciente próprio (protegido, correto), mas ficava
  // presa com o aviso amarelo sem nenhuma linha-irmã de fato pra resolver.
  const groups = new Map<string, AppointmentDraft[]>();
  for (const draft of drafts) {
    const key = identityKey(draft);
    const group = groups.get(key);
    if (group) group.push(draft);
    else groups.set(key, [draft]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const draft of group) {
      const hasNamesake = group.some((other) => other !== draft && namesMatch(other.name, draft.name));
      if (hasNamesake && !draft.issues.includes("duplicado")) {
        draft.issues.push("duplicado");
        draft.readyToSend = false;
      }
    }
  }

  return {
    sourceFormat: extraction.sourceFormat,
    municipality: extraction.municipality,
    executingUnit: extraction.executingUnit,
    doctor: extraction.doctor,
    procedure: extraction.procedure,
    warnings: extraction.warnings,
    drafts,
    summary: {
      total: drafts.length,
      readyToSend: drafts.filter((draft) => draft.readyToSend).length,
      needsReview: drafts.filter((draft) => !draft.readyToSend).length,
      withoutPhone: drafts.filter((draft) => draft.issues.includes("sem_telefone")).length,
    },
  };
}
