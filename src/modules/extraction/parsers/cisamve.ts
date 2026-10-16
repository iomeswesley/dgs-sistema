import type { ExtractedRow, ExtractionResult } from "../extraction.schema.js";
import { toIsoDateTime } from "./shared.js";

/*
  Formato "CISAMVE" — relatório "Agendamento de Exames" do consórcio
  (CISAMVE, gerado pelo IDS Saúde, programa TDmAgeExa). Achado em 2026-10-16
  (agenda de Doppler do dia 17/10): o cliente subiu e a lista ficou vazia
  ("formato não reconhecido").

  Uma linha por exame/paciente, nesta ordem (separadas por tab ou espaço):

    <DESCRIÇÃO DO EXAME> <DD/MM/AAAA> <HH:MM:SS> <NOME DO USUÁRIO>

  O que NÃO vem no arquivo: telefone, CNS, nascimento, município, médico.
  Os pacientes entram sem telefone (ficam "sem telefone" na Revisão, pra
  equipe completar) e o município/agenda/médico ficam por conta de quem sobe
  a lista. O cabeçalho traz só códigos ("Unidade de Saúde de Origem = 1471",
  "Laboratório = 1540"), que não servem de nome — não são lidos.

  O exame vem por LINHA (cada paciente pode fazer um exame diferente) e pode
  ter dígito e parênteses ("DOPPLER COLORIDO DE VASOS (ATÉ 3 VASOS)"), por
  isso o exame é tudo que vem antes da data, sem restringir caracteres.
*/

const ROW_PATTERN =
  /^(?<exam>\S.*?)\s+(?<date>\d{2}\/\d{2}\/\d{4})\s+(?<time>\d{2}:\d{2})(?::\d{2})?\s+(?<name>[A-ZÀ-ÖØ-Þa-zß-ÿ].*)$/;

export function parseCisamve(text: string): ExtractionResult {
  const rows: ExtractedRow[] = [];
  const dates = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(ROW_PATTERN);
    if (!match?.groups) continue; // cabeçalho, rodapé de página

    const { exam, date, time, name } = match.groups;
    if (!exam || !date || !time || !name) continue;
    const scheduledAt = toIsoDateTime(date, time);
    dates.add(date);

    rows.push({
      name: name.trim(),
      cns: null,
      birthDate: null,
      phones: [],
      procedure: exam.trim(),
      doctor: null,
      scheduledAt,
      requestingUnit: null,
      isFirstVisit: null,
      confidence: scheduledAt ? 1 : 0.6,
      notes: null,
    });
  }

  const warnings: string[] = [];
  if (rows.length === 0) {
    warnings.push("Nenhuma linha de paciente reconhecida no relatório do CISAMVE — confira o arquivo manualmente.");
  } else {
    warnings.push(
      "Este relatório do CISAMVE não traz telefone: os pacientes entram sem telefone e precisam ser completados em “Corrigir” antes do disparo."
    );
  }
  if (dates.size > 1) {
    warnings.push(`Este arquivo traz ${dates.size} dias de atendimento. Cada paciente fica com a própria data.`);
  }

  return {
    sourceFormat: "CISAMVE",
    municipality: null,
    executingUnit: null,
    doctor: null,
    procedure: null,
    rows,
    warnings,
    unrecognized: [],
  };
}
