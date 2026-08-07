import { prisma } from "@/lib/prisma.js";
import { findUniqueMatch } from "@/lib/text-match.js";
import { extractList } from "@/modules/extraction/extraction.service.js";
import type { ExtractionResult } from "@/modules/extraction/extraction.schema.js";

/*
  Roda antes de a lista existir no banco: lê o arquivo (rápido, local, sem
  IA) e tenta casar cabeçalho, médico, procedimento e agenda com o cadastro
  — só pra pré-preencher a tela de upload. Nunca decide sozinho quando há
  mais de um candidato possível (ex.: duas unidades com nome parecido); aí
  fica pra equipe escolher, como hoje.
*/

export interface ListPreview {
  sourceFormat: ExtractionResult["sourceFormat"];
  parsed: {
    municipality: string | null;
    executingUnit: string | null;
    doctor: string | null;
    procedure: string | null;
    firstScheduledAt: string | null;
  };
  rowCount: number;
  warnings: string[];
  suggestedMunicipalityId: number | null;
  suggestedUnitId: number | null;
  suggestedDoctorId: number | null;
  suggestedProcedureId: number | null;
  /** Agenda já cadastrada que bate com médico + unidade + data. */
  suggestedAgendaId: number | null;
  /**
   * Município e médico foram reconhecidos, mas nenhuma agenda existente bate
   * com a data — a equipe precisa confirmar/completar antes do disparo (é a
   * agenda que carrega o endereço que vai pra mensagem).
   */
  needsAgendaConfirmation: boolean;
}

export async function previewList(file: Buffer, mimeType: string): Promise<ListPreview> {
  const { result } = await extractList(file, mimeType);

  const firstScheduledAt = result.rows.find((row) => row.scheduledAt)?.scheduledAt ?? null;

  const municipalities = await prisma.municipality.findMany({ where: { active: true } });
  // Exact, não fuzzy: "Camboriú" não pode casar com "Balneário Camboriú" —
  // são municípios diferentes, e errar aqui manda o relatório final pro
  // contato da prefeitura errada.
  const municipality = findUniqueMatch(result.municipality, municipalities, (m) => m.name, { exact: true });

  const units = municipality
    ? await prisma.healthUnit.findMany({ where: { municipalityId: municipality.id, active: true } })
    : [];
  const unit = findUniqueMatch(result.executingUnit, units, (u) => u.name);

  const doctors = await prisma.doctor.findMany({ where: { active: true } });
  const doctor = findUniqueMatch(result.doctor, doctors, (d) => d.name);

  const procedures = await prisma.procedure.findMany();
  const procedure = findUniqueMatch(result.procedure, procedures, (p) => p.name);

  let suggestedAgendaId: number | null = null;
  let needsAgendaConfirmation = false;
  if (municipality && doctor && firstScheduledAt) {
    const date = new Date(firstScheduledAt.slice(0, 10));
    const agenda = await prisma.agenda.findFirst({
      where: {
        municipalityId: municipality.id,
        doctorId: doctor.id,
        date,
        unitId: unit?.id,
      },
    });
    if (agenda) suggestedAgendaId = agenda.id;
    else needsAgendaConfirmation = true;
  }

  return {
    sourceFormat: result.sourceFormat,
    parsed: {
      municipality: result.municipality,
      executingUnit: result.executingUnit,
      doctor: result.doctor,
      procedure: result.procedure,
      firstScheduledAt,
    },
    rowCount: result.rows.length,
    warnings: result.warnings,
    suggestedMunicipalityId: municipality?.id ?? null,
    suggestedUnitId: unit?.id ?? null,
    suggestedDoctorId: doctor?.id ?? null,
    suggestedProcedureId: procedure?.id ?? null,
    suggestedAgendaId,
    needsAgendaConfirmation,
  };
}
