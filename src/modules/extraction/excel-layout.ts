/*
  Layout do modelo Excel de importação ("modelo-importacao-dgs.xlsx").

  Fonte única de verdade: o gerador do modelo (`excel-template.ts`) e o
  leitor (`parsers/excel.ts`) usam as mesmas definições, então o arquivo
  que a gente entrega sempre é o que a gente sabe ler. Três abas:
  "Instruções" (só leitura humana), "Cabeçalho" (dados da agenda inteira) e
  "Pacientes" (uma linha por paciente).
*/

export const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const SHEET_INSTRUCTIONS = "Instruções";
export const SHEET_HEADER = "Cabeçalho";
export const SHEET_PATIENTS = "Pacientes";

/** Linhas pré-formatadas (e validadas) na aba Pacientes do modelo. */
export const TEMPLATE_PATIENT_ROWS = 2000;
/** Teto de linhas lidas — trava contra planilha gigante/corrompida. */
export const MAX_PATIENT_ROWS = 5000;

export type HeaderKey = "municipality" | "executingUnit" | "doctor" | "procedure" | "date";

export interface HeaderField {
  key: HeaderKey;
  label: string;
  required: boolean;
  format: string;
  example: string;
  help: string;
}

export const HEADER_FIELDS: HeaderField[] = [
  {
    key: "municipality",
    label: "Município",
    required: true,
    format: "Texto",
    example: "Pomerode",
    help: "Nome do município como está cadastrado no sistema, com acento. Sem sigla de UF.",
  },
  {
    key: "executingUnit",
    label: "Unidade de atendimento",
    required: false,
    format: "Texto",
    example: "Policlínica Municipal Prefeito Alwin Klotz",
    help: "Local onde o atendimento acontece. Se a agenda já estiver escolhida na plataforma, pode ficar em branco.",
  },
  {
    key: "doctor",
    label: "Médico",
    required: false,
    format: "Texto",
    example: "Eduardo Hahn Magarinos Torres",
    help: "Use quando TODA a lista for de um só médico. Se cada paciente tem um médico, deixe em branco e preencha a coluna Médico em Pacientes.",
  },
  {
    key: "procedure",
    label: "Procedimento padrão",
    required: false,
    format: "Texto",
    example: "Consulta em Ortopedia",
    help: "Use quando TODA a lista for do mesmo procedimento. Se variar por paciente, deixe em branco e preencha a coluna Procedimento.",
  },
  {
    key: "date",
    label: "Data do atendimento padrão",
    required: false,
    format: "Data DD/MM/AAAA",
    example: "25/09/2026",
    help: "Use quando TODOS forem atendidos no mesmo dia. Se varia, deixe em branco e preencha a coluna Data do atendimento.",
  },
];

export type PatientKey =
  | "name"
  | "cns"
  | "birthDate"
  | "phone1"
  | "phone2"
  | "procedure"
  | "doctor"
  | "date"
  | "time"
  | "requestingUnit"
  | "visitType";

export interface PatientColumn {
  key: PatientKey;
  /** Texto do cabeçalho na planilha. */
  label: string;
  /** Outros nomes aceitos pra essa coluna (já normalizados — ver `normalizeHeader`). */
  aliases: string[];
  required: boolean;
  /** Obrigatório só condicionalmente (ex.: "aqui ou no Cabeçalho"). */
  requiredNote?: string;
  format: string;
  example: string;
  help: string;
  width: number;
}

export const PATIENT_COLUMNS: PatientColumn[] = [
  {
    key: "name",
    label: "Nome completo *",
    aliases: ["nome", "paciente", "nome do paciente"],
    required: true,
    format: "Texto",
    example: "MARIA APARECIDA DA SILVA",
    help: "Nome completo do paciente, um por linha. Não abrevie e não junte dois pacientes na mesma linha.",
    width: 34,
  },
  {
    key: "cns",
    label: "CNS (Cartão SUS)",
    aliases: ["cns", "cartao sus", "cartao nacional de saude", "cartao sus cns"],
    required: false,
    format: "15 números, sem pontos nem espaços",
    example: "700000000000001",
    help: "Cartão Nacional de Saúde. Deixe a coluna como Texto (já vem assim no modelo) para o Excel não trocar por notação científica.",
    width: 20,
  },
  {
    key: "birthDate",
    label: "Data de nascimento",
    aliases: ["nascimento", "data nascimento", "dt nascimento", "data de nasc"],
    required: false,
    format: "Data DD/MM/AAAA",
    example: "13/05/1993",
    help: "Dia/mês/ano com 4 dígitos no ano. Ajuda a evitar confundir pacientes com o mesmo nome.",
    width: 18,
  },
  {
    key: "phone1",
    label: "Telefone 1 *",
    aliases: ["telefone", "celular", "telefone principal", "whatsapp", "fone"],
    required: true,
    format: "DDD + número, só números (ex.: 47999990001)",
    example: "47999990001",
    help: "Celular com DDD, de preferência com WhatsApp. Pode digitar com parênteses e traço, o sistema limpa. Sem telefone, o paciente não recebe a confirmação.",
    width: 18,
  },
  {
    key: "phone2",
    label: "Telefone 2",
    aliases: ["telefone 2", "celular 2", "telefone alternativo", "fone 2"],
    required: false,
    format: "DDD + número, só números",
    example: "4733334444",
    help: "Número alternativo. Usado quando o primeiro falha. Apenas UM número por célula.",
    width: 18,
  },
  {
    key: "procedure",
    label: "Procedimento",
    aliases: ["exame", "procedimento exame", "especialidade"],
    required: false,
    requiredNote: "Aqui ou no Cabeçalho",
    format: "Texto",
    example: "Consulta em Ortopedia",
    help: "Preencha só se variar de paciente pra paciente; senão use \"Procedimento padrão\" no Cabeçalho.",
    width: 34,
  },
  {
    key: "doctor",
    label: "Médico",
    aliases: ["medico", "profissional", "profissional executante"],
    required: false,
    requiredNote: "Aqui ou no Cabeçalho",
    format: "Texto",
    example: "Eduardo Hahn Magarinos Torres",
    help: "Preencha só se variar de paciente pra paciente; senão use \"Médico\" no Cabeçalho.",
    width: 30,
  },
  {
    key: "date",
    label: "Data do atendimento",
    aliases: ["data", "data atendimento", "data da consulta", "data consulta", "dia"],
    required: false,
    requiredNote: "Aqui ou no Cabeçalho",
    format: "Data DD/MM/AAAA",
    example: "25/09/2026",
    help: "Dia do atendimento. Preencha só se variar; senão use \"Data do atendimento padrão\" no Cabeçalho.",
    width: 20,
  },
  {
    key: "time",
    label: "Horário *",
    aliases: ["hora", "horario", "hora atendimento", "hora da consulta"],
    required: true,
    format: "Hora HH:MM (24 horas)",
    example: "07:30",
    help: "Horário de cada paciente, com dois pontos. Se a secretaria só informa o turno (manhã/tarde), coloque o horário de início do turno.",
    width: 12,
  },
  {
    key: "requestingUnit",
    label: "Unidade solicitante (UBS de origem)",
    aliases: ["unidade solicitante", "ubs", "ubs de origem", "unidade de origem", "origem"],
    required: false,
    format: "Texto",
    example: "UBS Centro",
    help: "Unidade de saúde que encaminhou o paciente. Opcional.",
    width: 30,
  },
  {
    key: "visitType",
    label: "Tipo de vaga",
    aliases: ["vaga", "tipo vaga", "tipo", "primeira vez ou retorno"],
    required: false,
    format: "1ª vez ou Retorno (escolha na lista)",
    example: "1ª vez",
    help: "Escolha na lista da célula. Deixe em branco se não souber.",
    width: 14,
  },
];

/** Minúsculo, sem acento, sem "(...)" e sem "*", espaços colapsados. */
export function normalizeHeader(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\*/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
