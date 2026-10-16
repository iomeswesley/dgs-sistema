import type { ExtractedRow, ExtractionResult, UnrecognizedGuess } from "../extraction.schema.js";
import { extractPhones } from "./shared.js";

/*
  Formato "IDS" — relatório "Agendamento de Consulta" do sistema IDS Saúde
  (IDS Desenvolvimento de Software, programa TDmAgeCon5181). Achado pela
  primeira vez em 2026-10-16 (Ascurra, agenda de neurologia de uma semana
  inteira). Diferente de todos os outros formatos, NADA vem numa linha só —
  o relatório é agrupado em níveis, um por linha:

    3 - UNIDADE INTEGRADA DE SAUDE       ← unidade (código - nome)
    19/10/2026                           ← data (vale até a próxima data)
    08:00:00                             ← horário (vale pro paciente seguinte)
    6537 - ALIDA POLTRONIERI ADAMI       ← paciente (código interno - nome)
    (47)3383-0880 (47)98814-0168 ...     ← telefones (Telefone, Celular, Contato)

  A linha da unidade tem o MESMO formato "código - NOME" do paciente — o que
  separa as duas é o contexto: a unidade vem sempre logo antes de uma data.
  Coluna vazia some do texto (não deixa marcador), então a posição do
  telefone não diz se é fixo ou celular — tanto faz, `normalizePhone()`
  decide pelo número. Sem procedimento, sem nome de médico ("Profissional =
  1877" é só um código), sem CNS e sem nascimento: médico e procedimento
  vêm da Agenda que a equipe vincula na hora de subir a lista.
*/

const DATE_LINE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_LINE = /^(\d{2}):(\d{2})(?::\d{2})?$/;
// "6537 - ALIDA POLTRONIERI ADAMI" — o nome precisa começar com letra.
const CODE_NAME_LINE = /^\d+\s*-\s*([A-Za-zÀ-ÖØ-öø-ÿ].*)$/;
const PHONES_LINE = /^(?:\(\d{2}\)\s*\d{4,5}-?\d{4}\s*)+$/;

// Cabeçalho/rodapé repetido em toda página. "Horário: 08:26:13" e "Data:
// 16/10/2026" são a hora/data de EMISSÃO do relatório, não do atendimento —
// têm que sair antes de qualquer teste de data/horário.
const PAGE_NOISE = [
  /^C\.N\.P\.J/i,
  /^Data:\s/i,
  /^Hor[aá]rio:\s/i,
  /^Munic[ií]pio de\s/i,
  /^Agendamento de Consulta/i,
  /^Situa[cç][aã]o\s*=/i,
  /^Profissional\s*=/i,
  /^Data entre\s/i,
  /^Agrupamento\s*=/i,
  /^Telefone\s+Tel\./i,
  /^IDS Desenvolvimento/i,
  /^--\s*\d+\s+of\s+\d+\s*--$/,
];

/** Telefone de preenchimento do cadastro, tipo "(99)99999-9999" — não é de ninguém. */
function isPlaceholderPhone(phone: string): boolean {
  const subscriber = phone.replace(/\D/g, "").slice(2);
  return /^(\d)\1+$/.test(subscriber);
}

export function parseIds(text: string): ExtractionResult {
  const municipality = text.match(/Munic[ií]pio de\s+(.+)/i)?.[1]?.trim() ?? null;

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !PAGE_NOISE.some((noise) => noise.test(line)));

  const rows: ExtractedRow[] = [];
  const warnings: string[] = [];
  const unrecognized: UnrecognizedGuess[] = [];
  const units: string[] = [];
  const dates = new Set<string>();

  let date: string | null = null;
  let time: string | null = null;
  let current: ExtractedRow | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const dateMatch = line.match(DATE_LINE);
    if (dateMatch) {
      date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      dates.add(date);
      time = null;
      current = null;
      continue;
    }

    const timeMatch = line.match(TIME_LINE);
    if (timeMatch) {
      time = `${timeMatch[1]}:${timeMatch[2]}`;
      current = null;
      continue;
    }

    const nameMatch = line.match(CODE_NAME_LINE);
    if (nameMatch) {
      const name = nameMatch[1]!.trim();
      if (lines[i + 1] && DATE_LINE.test(lines[i + 1]!)) {
        if (!units.includes(name)) units.push(name);
        current = null;
        continue;
      }

      current = {
        name,
        cns: null,
        birthDate: null,
        phones: [],
        procedure: null,
        doctor: null,
        scheduledAt: date && time ? `${date}T${time}` : null,
        requestingUnit: null,
        isFirstVisit: null,
        confidence: date && time ? 1 : 0.6,
        notes: date && time ? null : "Horário do atendimento não encontrado no arquivo.",
      };
      rows.push(current);
      continue;
    }

    if (PHONES_LINE.test(line) && current) {
      for (const phone of extractPhones(line)) {
        if (!isPlaceholderPhone(phone) && !current.phones.includes(phone)) current.phones.push(phone);
      }
      continue;
    }

    // Qualquer outra coisa é inesperada nesse relatório — avisa em vez de
    // engolir em silêncio (pode ser um paciente com nome fora do padrão).
    warnings.push(`Registro não reconhecido: "${line}"`);
    unrecognized.push({ rawText: line, name: null, cns: null, birthDate: null, phones: extractPhones(line) });
  }

  if (rows.length === 0) {
    warnings.push("Nenhum paciente reconhecido no relatório do IDS Saúde — confira o arquivo manualmente.");
  }
  if (units.length > 1) {
    warnings.push(
      `Este arquivo traz ${units.length} unidades de atendimento (${units.join(", ")}) — a mensagem usa o endereço da unidade da agenda vinculada; confira.`
    );
  }
  if (dates.size > 1) {
    const sorted = [...dates].sort().map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
    warnings.push(
      `Este arquivo traz ${dates.size} dias de atendimento (${sorted.join(", ")}). Cada paciente fica com a própria data; a agenda vinculada é só a do primeiro dia.`
    );
  }

  return {
    sourceFormat: "IDS",
    municipality,
    executingUnit: units[0] ?? null,
    doctor: null,
    procedure: null,
    rows,
    warnings,
    unrecognized,
  };
}
