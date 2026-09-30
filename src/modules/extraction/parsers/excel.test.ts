import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseExcel } from "./excel.js";
import { buildImportTemplate } from "../excel-template.js";
import { PATIENT_COLUMNS } from "../excel-layout.js";
import { mapExtraction } from "../extraction.mapper.js";

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

/** Abre o modelo oficial e devolve as abas prontas pra preencher. */
async function openTemplate() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await buildImportTemplate()) as unknown as ArrayBuffer);
  return {
    workbook,
    header: workbook.getWorksheet("Cabeçalho")!,
    patients: workbook.getWorksheet("Pacientes")!,
  };
}

const col = (key: string) => PATIENT_COLUMNS.findIndex((c) => c.key === key) + 1;

describe("modelo Excel de importação", () => {
  it("o modelo gerado tem as 3 abas e os cabeçalhos esperados", async () => {
    const { workbook, patients } = await openTemplate();
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Instruções", "Cabeçalho", "Pacientes"]);
    expect(PATIENT_COLUMNS.map((c, i) => patients.getCell(1, i + 1).value)).toEqual(PATIENT_COLUMNS.map((c) => c.label));
  });

  it("modelo vazio lê sem paciente e sem quebrar", async () => {
    const result = await parseExcel(await buildImportTemplate());
    expect(result.sourceFormat).toBe("EXCEL");
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/Nenhum paciente/);
  });

  it("modelo preenchido: cabeçalho + pacientes (datas, hora, telefone e CNS em formatos diferentes)", async () => {
    const { workbook, header, patients } = await openTemplate();
    header.getCell("B2").value = "Pomerode";
    header.getCell("B3").value = "Policlínica Municipal";
    header.getCell("B4").value = "Eduardo Hahn Magarinos Torres";
    header.getCell("B5").value = "Consulta em Ortopedia";
    header.getCell("B6").value = new Date(Date.UTC(2026, 8, 25)); // data de verdade

    // Paciente 1: tudo como o modelo pede (texto + datas reais).
    patients.getCell(2, col("name")).value = "MARIA APARECIDA DA SILVA";
    patients.getCell(2, col("cns")).value = "700000000000001";
    patients.getCell(2, col("birthDate")).value = new Date(Date.UTC(1993, 4, 13));
    patients.getCell(2, col("phone1")).value = "(47) 99999-0001";
    patients.getCell(2, col("phone2")).value = "4733334444";
    patients.getCell(2, col("time")).value = new Date(Date.UTC(1899, 11, 30, 7, 30));
    patients.getCell(2, col("visitType")).value = "1ª vez";

    // Paciente 2: valores "digitados soltos" — número puro, data como texto, hora como fração.
    patients.getCell(3, col("name")).value = "  JOSE   DOS SANTOS ";
    patients.getCell(3, col("phone1")).value = 47999990002;
    patients.getCell(3, col("birthDate")).value = "05/11/1950";
    patients.getCell(3, col("date")).value = "26/09/2026";
    patients.getCell(3, col("time")).value = 0.5; // 12:00
    patients.getCell(3, col("procedure")).value = "Consulta em Cardiologia";
    patients.getCell(3, col("doctor")).value = "Outro Médico";
    patients.getCell(3, col("visitType")).value = "Retorno";
    patients.getCell(3, col("requestingUnit")).value = "UBS Centro";

    const result = await parseExcel(await toBuffer(workbook));
    expect(result.municipality).toBe("Pomerode");
    expect(result.executingUnit).toBe("Policlínica Municipal");
    expect(result.doctor).toBe("Eduardo Hahn Magarinos Torres");
    expect(result.procedure).toBe("Consulta em Ortopedia");
    expect(result.rows).toHaveLength(2);

    expect(result.rows[0]).toMatchObject({
      name: "MARIA APARECIDA DA SILVA",
      cns: "700000000000001",
      birthDate: "1993-05-13",
      phones: ["47999990001", "4733334444"],
      procedure: null, // herda do cabeçalho
      doctor: null,
      scheduledAt: "2026-09-25T07:30", // data vem do cabeçalho
      isFirstVisit: true,
      confidence: 1,
      notes: null,
    });
    expect(result.rows[1]).toMatchObject({
      name: "JOSE DOS SANTOS",
      phones: ["47999990002"],
      birthDate: "1950-11-05",
      procedure: "Consulta em Cardiologia",
      doctor: "Outro Médico",
      scheduledAt: "2026-09-26T12:00",
      requestingUnit: "UBS Centro",
      isFirstVisit: false,
      confidence: 1,
    });
  });

  it("formato errado vira aviso na linha (confiança baixa), não derruba a lista", async () => {
    const { workbook, header, patients } = await openTemplate();
    header.getCell("B2").value = "Pomerode";
    patients.getCell(2, col("name")).value = "FULANO DE TAL";
    patients.getCell(2, col("cns")).value = "12345"; // curto
    patients.getCell(2, col("birthDate")).value = "32/13/1990"; // inexistente
    patients.getCell(2, col("date")).value = "25 de setembro"; // texto
    patients.getCell(2, col("time")).value = "manhã"; // sem horário real
    patients.getCell(2, col("visitType")).value = "talvez";

    const result = await parseExcel(await toBuffer(workbook));
    const row = result.rows[0]!;
    expect(row.cns).toBeNull();
    expect(row.birthDate).toBeNull();
    expect(row.scheduledAt).toBeNull();
    expect(row.isFirstVisit).toBeNull();
    expect(row.confidence).toBeLessThan(0.8);
    expect(row.notes).toMatch(/CNS/);
    expect(row.notes).toMatch(/nascimento/);
    expect(row.notes).toMatch(/Horário "manhã"/);
    expect(row.notes).toMatch(/linha 2/);
  });

  it("horário aceito em texto (7:30, 07h30) e linhas em branco são ignoradas", async () => {
    const { workbook, header, patients } = await openTemplate();
    header.getCell("B2").value = "Pomerode";
    header.getCell("B6").value = "25/09/2026"; // data como texto também vale
    patients.getCell(2, col("name")).value = "A UM";
    patients.getCell(2, col("time")).value = "7:30";
    // linha 3 em branco de propósito
    patients.getCell(4, col("name")).value = "B DOIS";
    patients.getCell(4, col("time")).value = "07h30";

    const result = await parseExcel(await toBuffer(workbook));
    expect(result.rows.map((r) => [r.name, r.scheduledAt])).toEqual([
      ["A UM", "2026-09-25T07:30"],
      ["B DOIS", "2026-09-25T07:30"],
    ]);
  });

  it("colunas fora da ordem / com nomes alternativos / extras ainda funcionam", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Planilha da secretaria");
    sheet.addRow(["Observação interna", "Hora", "Paciente", "Celular"]);
    sheet.addRow(["x", "08:15", "ANA LIMA", "(47) 98888-7777"]);
    const result = await parseExcel(await toBuffer(workbook));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ name: "ANA LIMA", phones: ["47988887777"] });
    expect(result.warnings.join(" ")).toMatch(/Colunas ignoradas.*Observação interna/);
    // sem data em lugar nenhum -> scheduledAt null (vira "sem_data" na revisão)
    expect(result.rows[0]!.scheduledAt).toBeNull();
  });

  it("planilha qualquer (sem coluna de nome) dá mensagem pedindo o modelo, sem lançar erro", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet1").addRow(["Coluna A", "Coluna B"]);
    const result = await parseExcel(await toBuffer(workbook));
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/Baixar modelo Excel/);
  });

  it("arquivo que não é Excel é recusado com mensagem clara", async () => {
    await expect(parseExcel(Buffer.from("isso não é um xlsx"))).rejects.toThrow(/\.xlsx/);
  });

  it("passa pelo mapeador: telefone válido fica pronto, inválido e sem horário ficam em revisão", async () => {
    const { workbook, header, patients } = await openTemplate();
    header.getCell("B2").value = "Pomerode";
    header.getCell("B4").value = "Dr. Fulano";
    header.getCell("B5").value = "Consulta";
    header.getCell("B6").value = "25/09/2026";
    patients.getCell(2, col("name")).value = "PRONTA";
    patients.getCell(2, col("phone1")).value = "47999990001";
    patients.getCell(2, col("time")).value = "09:00";
    patients.getCell(3, col("name")).value = "TELEFONE RUIM";
    patients.getCell(3, col("phone1")).value = "123";
    patients.getCell(3, col("time")).value = "09:30";

    const mapped = mapExtraction(await parseExcel(await toBuffer(workbook)));
    expect(mapped.drafts[0]!.readyToSend).toBe(true);
    expect(mapped.drafts[1]!.readyToSend).toBe(false);
    expect(mapped.drafts[1]!.issues).toContain("telefone_invalido");
  });

  it("município escrito com sigla de UF (TIMBÓ-SC, Timbó/SC, Timbó (SC)) é limpo pro nome do cadastro", async () => {
    for (const [typed, expected] of [
      ["TIMBÓ-SC", "TIMBÓ"],
      ["Timbó / SC", "Timbó"],
      ["Timbó (SC)", "Timbó"],
      ["Balneário Camboriú - SC", "Balneário Camboriú"],
      ["Pomerode", "Pomerode"],
    ]) {
      const { workbook, header } = await openTemplate();
      header.getCell("B2").value = typed;
      const result = await parseExcel(await toBuffer(workbook));
      expect(result.municipality).toBe(expected);
    }
  });

  it("modelo com cadastro do cliente: aba Listas oculta + menus nas células, e ainda lê normal", async () => {
    const started = Date.now();
    const buffer = await buildImportTemplate({
      municipalities: ["Timbó", "Blumenau"],
      units: ["Policlínica Laudila", "UBS Centro"],
      doctors: ["Luiz Felipe Beserra Barros"],
      procedures: [],
    });
    expect(Date.now() - started).toBeLessThan(5000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const lists = workbook.getWorksheet("Listas")!;
    expect(lists.state).toBe("hidden");
    expect(lists.getCell("A2").value).toBe("Blumenau"); // ordenado
    expect(lists.getCell("A3").value).toBe("Timbó");

    const header = workbook.getWorksheet("Cabeçalho")!;
    expect(header.getCell("B2").dataValidation?.type).toBe("list");
    expect(header.getCell("B2").dataValidation?.formulae?.[0]).toBe("Listas!$A$2:$A$3");
    expect(header.getCell("B5").dataValidation).toBeUndefined(); // procedimentos vazios: sem menu
    expect(workbook.getWorksheet("Pacientes")!.getCell("G2").dataValidation?.type).toBe("list"); // Médico

    header.getCell("B2").value = "Timbó";
    workbook.getWorksheet("Pacientes")!.getCell(2, col("name")).value = "FULANO";
    const result = await parseExcel(await toBuffer(workbook));
    expect(result.municipality).toBe("Timbó");
    expect(result.rows).toHaveLength(1);
  });
});
