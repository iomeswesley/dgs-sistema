import ExcelJS from "exceljs";
import {
  HEADER_FIELDS,
  PATIENT_COLUMNS,
  SHEET_HEADER,
  SHEET_INSTRUCTIONS,
  SHEET_PATIENTS,
  TEMPLATE_PATIENT_ROWS,
} from "./excel-layout.js";

/*
  Gera o "modelo-importacao-dgs.xlsx" — a planilha padrão que o cliente
  preenche copiando os dados do Excel da secretaria, pra subir na
  plataforma sem depender da gente a cada layout novo.

  Cada coluna já vem com o formato certo da célula (texto pra CNS/telefone,
  data DD/MM/AAAA, hora HH:MM), com validação do Excel (aviso ao digitar
  valor fora do formato) e uma nota no cabeçalho explicando o que entra.
*/

const BRAND = "FF1F3A5F";
const REQUIRED_FILL = "FFFDE9E7";
const OPTIONAL_FILL = "FFEAF0F7";
const DATE_FORMAT = "dd/mm/yyyy";
const TIME_FORMAT = "hh:mm";

const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBFC8D4" } },
  left: { style: "thin", color: { argb: "FFBFC8D4" } },
  bottom: { style: "thin", color: { argb: "FFBFC8D4" } },
  right: { style: "thin", color: { argb: "FFBFC8D4" } },
};

function styleHeaderCell(cell: ExcelJS.Cell, required: boolean) {
  cell.font = { bold: true, color: { argb: required ? "FF8A1C12" : BRAND }, size: 11 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: required ? REQUIRED_FILL : OPTIONAL_FILL } };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  cell.border = thin;
}

/** Cadastro do cliente, pros menus de opções do modelo (evita erro de digitação). */
export interface TemplateCatalog {
  municipalities: string[];
  units: string[];
  doctors: string[];
  procedures: string[];
}

type ListKey = keyof TemplateCatalog;

const MAX_LIST_ITEMS = 2000;

export async function buildImportTemplate(catalog?: TemplateCatalog): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DGS";
  workbook.title = "Modelo de importação de agenda";

  /* ---------------- Listas (oculta): opções dos menus ---------------- */
  // Uma coluna por tipo. O Excel aceita menu que aponta pra outra aba; a aba
  // fica oculta pra ninguém mexer. Valor fora da lista só AVISA (não trava) —
  // município/médico novo ainda pode ser digitado.
  const listRanges: Partial<Record<ListKey, string>> = {};
  if (catalog) {
    const lists = workbook.addWorksheet("Listas", { state: "hidden" });
    const columns: [ListKey, string][] = [
      ["municipalities", "Municípios"],
      ["units", "Unidades"],
      ["doctors", "Médicos"],
      ["procedures", "Procedimentos"],
    ];
    columns.forEach(([key, title], i) => {
      lists.getCell(1, i + 1).value = title;
      const items = [...new Set(catalog[key].map((item) => item.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .slice(0, MAX_LIST_ITEMS);
      items.forEach((item, r) => {
        lists.getCell(r + 2, i + 1).value = item;
      });
      if (items.length > 0) {
        const letter = lists.getColumn(i + 1).letter;
        listRanges[key] = `Listas!$${letter}$2:$${letter}$${items.length + 1}`;
      }
    });
  }

  const menuValidation = (key: ListKey, what: string): ExcelJS.DataValidation | null => {
    const range = listRanges[key];
    if (!range) return null;
    return {
      type: "list",
      allowBlank: true,
      formulae: [range],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: `${what} diferente do cadastro`,
      error: `Esse ${what.toLowerCase()} não está no cadastro do sistema. Escolha um do menu (seta ao lado da célula) para evitar erro; se for novo, pode manter.`,
      showInputMessage: true,
      promptTitle: what,
      prompt: "Escolha no menu (seta ao lado da célula).",
    };
  };

  /* ---------------- Instruções ---------------- */
  const info = workbook.addWorksheet(SHEET_INSTRUCTIONS, { properties: { tabColor: { argb: BRAND } } });
  info.columns = [{ width: 34 }, { width: 14 }, { width: 38 }, { width: 34 }, { width: 70 }];
  info.getCell("A1").value = "Modelo de importação de agenda — como preencher";
  info.getCell("A1").font = { bold: true, size: 16, color: { argb: BRAND } };

  const steps = [
    "1. Abra o Excel que a secretaria enviou e este modelo lado a lado.",
    "2. Aba \"Cabeçalho\": preencha os dados que valem para a lista INTEIRA (município, médico, procedimento, data).",
    "3. Aba \"Pacientes\": copie uma linha por paciente, coluna por coluna, para as colunas correspondentes. Cole sempre como VALORES (Colar especial > Valores), para não trazer a formatação do arquivo original.",
    "4. Não altere, apague nem mude a ordem dos títulos da primeira linha de \"Pacientes\" e de \"Cabeçalho\" (coluna A).",
    "5. Salve como .xlsx e envie em Listas (mesmo botão de enviar o PDF). O sistema mostra a revisão antes de qualquer mensagem sair.",
    catalog
      ? "Município, Unidade, Médico e Procedimento têm MENU de opções (seta ao lado da célula) com o que já está cadastrado no sistema — escolha no menu em vez de digitar."
      : "",
    "Colunas marcadas com * são obrigatórias. O que faltar não trava o envio, mas a linha fica destacada na revisão.",
  ];
  steps.splice(0, steps.length, ...steps.filter(Boolean));
  steps.forEach((text, i) => {
    const cell = info.getCell(`A${3 + i}`);
    cell.value = text;
    cell.alignment = { wrapText: false };
    if (i === steps.length - 1) cell.font = { italic: true, color: { argb: "FF5B6776" } };
  });

  let row = 3 + steps.length + 1;
  info.getCell(`A${row}`).value = "Aba \"Cabeçalho\" (dados da agenda inteira)";
  info.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: BRAND } };
  row++;
  ["Campo", "Obrigatório", "Formato", "Exemplo", "Observação"].forEach((title, i) => {
    const cell = info.getCell(row, i + 1);
    cell.value = title;
    styleHeaderCell(cell, false);
  });
  row++;
  for (const field of HEADER_FIELDS) {
    [field.label, field.required ? "Sim" : "Não", field.format, field.example, field.help].forEach((text, i) => {
      const cell = info.getCell(row, i + 1);
      cell.value = text;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = thin;
    });
    row++;
  }

  row++;
  info.getCell(`A${row}`).value = "Aba \"Pacientes\" (uma linha por paciente)";
  info.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: BRAND } };
  row++;
  ["Coluna", "Obrigatório", "Formato", "Exemplo", "Observação"].forEach((title, i) => {
    const cell = info.getCell(row, i + 1);
    cell.value = title;
    styleHeaderCell(cell, false);
  });
  row++;
  for (const column of PATIENT_COLUMNS) {
    const required = column.required ? "Sim" : (column.requiredNote ?? "Não");
    [column.label.replace(/\s*\*$/, ""), required, column.format, column.example, column.help].forEach((text, i) => {
      const cell = info.getCell(row, i + 1);
      cell.value = text;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = thin;
    });
    row++;
  }

  row++;
  info.getCell(`A${row}`).value = "Erros mais comuns";
  info.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: BRAND } };
  row++;
  [
    "• Data com ano de 2 dígitos (25/09/26) ou com texto (\"25 de setembro\"): use sempre DD/MM/AAAA.",
    "• Horário como \"7h30\" ou \"manhã\": use 07:30. Turno sem horário? Coloque o horário de início do turno.",
    "• Telefone com dois números na mesma célula: ponha o segundo em \"Telefone 2\".",
    "• CNS com menos ou mais de 15 números: o sistema ignora o CNS e avisa na revisão (confira o cadastro na fonte).",
    "• Nome do município diferente do cadastro (ex.: sem acento): o sistema pede para você escolher o município ao enviar.",
    "• Linhas em branco no meio da lista: são ignoradas, mas evite.",
    "• Mais de um paciente numa linha, ou nomes abreviados: cada paciente precisa da sua própria linha, com o nome completo.",
  ].forEach((text) => {
    info.getCell(`A${row}`).value = text;
    row++;
  });

  /* ---------------- Cabeçalho ---------------- */
  const head = workbook.addWorksheet(SHEET_HEADER, { properties: { tabColor: { argb: "FF2E7D6B" } } });
  head.columns = [{ width: 32 }, { width: 48 }, { width: 70 }];
  ["Campo", "Valor", "Como preencher"].forEach((title, i) => styleHeaderCell(head.getCell(1, i + 1), i === 1));
  HEADER_FIELDS.forEach((field, i) => {
    const r = i + 2;
    const label = head.getCell(r, 1);
    label.value = field.label + (field.required ? " *" : "");
    label.font = { bold: true };
    label.border = thin;
    label.fill = { type: "pattern", pattern: "solid", fgColor: { argb: field.required ? REQUIRED_FILL : OPTIONAL_FILL } };

    const value = head.getCell(r, 2);
    value.border = thin;
    value.alignment = { horizontal: "left" };
    if (field.key === "date") {
      value.numFmt = DATE_FORMAT;
      value.dataValidation = {
        type: "date",
        operator: "between",
        allowBlank: true,
        formulae: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Data inválida",
        error: "Digite a data no formato DD/MM/AAAA (ex.: 25/09/2026).",
        showInputMessage: true,
        promptTitle: field.label,
        prompt: "Formato DD/MM/AAAA",
      };
    } else {
      value.numFmt = "@";
      const menu =
        field.key === "municipality"
          ? menuValidation("municipalities", "Município")
          : field.key === "executingUnit"
            ? menuValidation("units", "Unidade")
            : field.key === "doctor"
              ? menuValidation("doctors", "Médico")
              : field.key === "procedure"
                ? menuValidation("procedures", "Procedimento")
                : null;
      if (menu) value.dataValidation = menu;
    }

    const help = head.getCell(r, 3);
    help.value = `${field.format}. ${field.help}`;
    help.alignment = { wrapText: true, vertical: "top" };
    help.font = { color: { argb: "FF5B6776" } };
    help.border = thin;
    head.getRow(r).height = 34;
  });
  head.views = [{ state: "frozen", ySplit: 1 }];

  /* ---------------- Pacientes ---------------- */
  const sheet = workbook.addWorksheet(SHEET_PATIENTS, { properties: { tabColor: { argb: "FFC0392B" } } });
  sheet.columns = PATIENT_COLUMNS.map((column) => ({ width: column.width }));
  const lastRow = TEMPLATE_PATIENT_ROWS + 1;

  PATIENT_COLUMNS.forEach((column, i) => {
    const colIndex = i + 1;
    const headerCell = sheet.getCell(1, colIndex);
    headerCell.value = column.label;
    styleHeaderCell(headerCell, column.required);
    headerCell.note = {
      texts: [
        { text: `${column.label.replace(/\s*\*$/, "")}\n`, font: { bold: true } },
        { text: `Formato: ${column.format}\nExemplo: ${column.example}\n${column.help}` },
      ],
      margins: { insetmode: "custom", inset: [0.25, 0.25, 0.35, 0.35] },
    };

    const letter = sheet.getColumn(colIndex).letter;
    for (let r = 2; r <= lastRow; r++) {
      const cell = sheet.getCell(`${letter}${r}`);
      cell.border = thin;
      cell.alignment = { horizontal: "left" };
      switch (column.key) {
        case "birthDate":
        case "date":
          cell.numFmt = DATE_FORMAT;
          break;
        case "time":
          cell.numFmt = TIME_FORMAT;
          break;
        default:
          cell.numFmt = "@"; // texto: CNS/telefone nunca viram notação científica
      }
    }

    // Validação de entrada aplicada à coluna inteira (linhas 2..lastRow).
    const range = `${letter}2:${letter}${lastRow}`;
    const validation =
      column.key === "procedure"
        ? menuValidation("procedures", "Procedimento")
        : column.key === "doctor"
          ? menuValidation("doctors", "Médico")
          : validationFor(column.key);
    if (validation) {
      for (let r = 2; r <= lastRow; r++) sheet.getCell(`${letter}${r}`).dataValidation = { ...validation };
    }
    void range;
  });

  sheet.getRow(1).height = 36;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: PATIENT_COLUMNS.length } };

  // Abre direto na aba Pacientes? Não: a primeira aba (Instruções) é a que a
  // pessoa deve ler antes. Só garante que ela é a ativa.
  workbook.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function validationFor(key: (typeof PATIENT_COLUMNS)[number]["key"]): ExcelJS.DataValidation | null {
  switch (key) {
    case "birthDate":
      return {
        type: "date",
        operator: "between",
        allowBlank: true,
        formulae: [new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Data inválida",
        error: "Digite a data de nascimento no formato DD/MM/AAAA (ex.: 13/05/1993).",
      };
    case "date":
      return {
        type: "date",
        operator: "between",
        allowBlank: true,
        formulae: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Data inválida",
        error: "Digite a data no formato DD/MM/AAAA (ex.: 25/09/2026).",
      };
    case "time":
      return {
        type: "decimal",
        operator: "between",
        allowBlank: true,
        formulae: [0, 0.999988],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Horário inválido",
        error: "Digite o horário no formato HH:MM, de 00:00 a 23:59 (ex.: 07:30).",
      };
    case "cns":
      return {
        type: "textLength",
        operator: "equal",
        allowBlank: true,
        formulae: [15],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "CNS com tamanho diferente de 15",
        error: "O CNS tem 15 números, sem pontos nem espaços. Se não tiver, deixe em branco.",
      };
    case "visitType":
      return {
        type: "list",
        allowBlank: true,
        formulae: ['"1ª vez,Retorno"'],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Valor inválido",
        error: "Escolha 1ª vez ou Retorno na lista (ou deixe em branco).",
      };
    default:
      return null;
  }
}
