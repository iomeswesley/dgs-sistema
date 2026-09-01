import { describe, expect, it } from "vitest";
import {
  buildIndicatorsCore,
  buildMessagesPerDaySeries,
  type AppointmentInput,
  type ClosingInput,
  type FeeInput,
} from "./indicators.js";

function appointment(overrides: Partial<AppointmentInput> = {}): AppointmentInput {
  return {
    doctorId: 1,
    municipalityId: 10,
    procedureId: 100,
    scheduledAt: new Date("2026-06-01"),
    status: "CONFIRMADO",
    doctorName: "Dra. Exemplo",
    municipalityName: "Camboriú",
    procedureName: "Consulta",
    ...overrides,
  };
}

function closing(overrides: Partial<ClosingInput> = {}): ClosingInput {
  return {
    doctorId: 1,
    municipalityId: 10,
    procedureId: 100,
    date: new Date("2026-06-01"),
    doctorName: "Dra. Exemplo",
    municipalityName: "Camboriú",
    procedureName: "Consulta",
    attendedReported: null,
    paidCount: null,
    extrasCount: 0,
    ...overrides,
  };
}

describe("buildIndicatorsCore", () => {
  it("separa contatáveis de não contatáveis e conta confirmação/recusa/sem resposta", () => {
    const appointments = [
      appointment({ status: "CONFIRMADO" }),
      appointment({ status: "RECUSADO" }),
      appointment({ status: "SEM_RESPOSTA" }),
      appointment({ status: "FALHA" }),
      appointment({ status: "SEM_TELEFONE" }),
    ];
    const { totals } = buildIndicatorsCore(appointments, [], [], "doctor");

    expect(totals.planned).toBe(5);
    expect(totals.unreachable).toBe(1);
    expect(totals.contactable).toBe(4);
    expect(totals.confirmed).toBe(1);
    expect(totals.refused).toBe(1);
    expect(totals.noAnswer).toBe(2);
  });

  it("% Confirmação = confirmados ÷ contatáveis, ignorando quem não tem telefone", () => {
    const appointments = [
      appointment({ status: "CONFIRMADO" }),
      appointment({ status: "CONFIRMADO" }),
      appointment({ status: "SEM_RESPOSTA" }),
      appointment({ status: "SEM_TELEFONE" }), // não entra no denominador
    ];
    const { totals } = buildIndicatorsCore(appointments, [], [], "doctor");

    expect(totals.confirmationRate).toBeCloseTo(2 / 3);
  });

  it("taxas ficam null (não zero) sem base pra calcular", () => {
    const { totals } = buildIndicatorsCore([], [], [], "doctor");

    expect(totals.confirmationRate).toBeNull();
    expect(totals.attendanceRate).toBeNull();
    expect(totals.utilizationRate).toBeNull();
    expect(totals.divergenceRate).toBeNull();
  });

  it("% Comparecimento e % Aproveitamento só aparecem depois do check 2 (attended) lançado", () => {
    const appointments = [appointment({ status: "CONFIRMADO" }), appointment({ status: "CONFIRMADO" })];
    const withoutCheck2 = buildIndicatorsCore(appointments, [], [], "doctor").totals;
    expect(withoutCheck2.attendanceRate).toBeNull();
    expect(withoutCheck2.utilizationRate).toBeNull();

    const withCheck2 = buildIndicatorsCore(
      appointments,
      [closing({ attendedReported: 1 })],
      [],
      "doctor"
    ).totals;
    expect(withCheck2.attendanceRate).toBeCloseTo(1 / 2); // atendidos ÷ confirmados
    expect(withCheck2.utilizationRate).toBeCloseTo(1 / 2); // atendidos ÷ planejados
  });

  it("Divergência = pagos ÷ atendidos, só depois do check 3 (paidCount)", () => {
    const closings = [closing({ attendedReported: 10, paidCount: 8 })];
    const { totals } = buildIndicatorsCore([], closings, [], "doctor");

    expect(totals.divergenceRate).toBeCloseTo(8 / 10);
  });

  it("repasse/faturamento/margem só calculam quando há valor cadastrado pra médico×procedimento", () => {
    const closings = [closing({ paidCount: 10 })];
    const fees: FeeInput[] = [{ doctorId: 1, procedureId: 100, doctorFee: 50, cityRate: 80 }];

    const semValor = buildIndicatorsCore([], closings, [], "doctor").totals;
    expect(semValor.doctorPayout).toBeNull();
    expect(semValor.cityBilling).toBeNull();
    expect(semValor.margin).toBeNull();

    const comValor = buildIndicatorsCore([], closings, fees, "doctor").totals;
    expect(comValor.doctorPayout).toBe(500); // 10 × 50
    expect(comValor.cityBilling).toBe(800); // 10 × 80
    expect(comValor.margin).toBe(300); // 800 − 500
  });

  it("agrupa por médico, município, procedimento ou mês, sem misturar totais entre grupos", () => {
    const appointments = [
      appointment({ doctorId: 1, doctorName: "Dr. A", status: "CONFIRMADO" }),
      appointment({ doctorId: 2, doctorName: "Dra. B", status: "CONFIRMADO" }),
      appointment({ doctorId: 2, doctorName: "Dra. B", status: "RECUSADO" }),
    ];

    const byDoctor = buildIndicatorsCore(appointments, [], [], "doctor");
    expect(byDoctor.breakdown).toHaveLength(2);
    const groupA = byDoctor.breakdown.find((g) => g.label === "Dr. A");
    const groupB = byDoctor.breakdown.find((g) => g.label === "Dra. B");
    expect(groupA?.planned).toBe(1);
    expect(groupB?.planned).toBe(2);
    // Total geral não deve vazar entre grupos.
    expect(byDoctor.totals.planned).toBe(3);
  });

  it("agrupamento por mês usa ano-mês da data do agendamento", () => {
    const appointments = [
      appointment({ scheduledAt: new Date(2026, 5, 1) }), // junho
      appointment({ scheduledAt: new Date(2026, 5, 15) }), // junho
      appointment({ scheduledAt: new Date(2026, 6, 1) }), // julho
    ];
    const { breakdown } = buildIndicatorsCore(appointments, [], [], "month");

    expect(breakdown.map((g) => g.label).sort()).toEqual(["2026-06", "2026-07"]);
    expect(breakdown.find((g) => g.label === "2026-06")?.planned).toBe(2);
  });

  it("procedimento não informado (null) agrupa junto, com rótulo próprio", () => {
    const appointments = [appointment({ procedureId: null, procedureName: null })];
    const { breakdown } = buildIndicatorsCore(appointments, [], [], "procedure");

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.label).toBe("Não informado");
  });

  it("extras (encaixes) somam mesmo sem attended/paid lançados", () => {
    const closings = [closing({ extrasCount: 3 }), closing({ extrasCount: 2 })];
    const { totals } = buildIndicatorsCore([], closings, [], "doctor");

    expect(totals.extras).toBe(5);
  });
});

describe("buildMessagesPerDaySeries", () => {
  it("preenche com 0 os dias sem envio dentro do intervalo", () => {
    const series = buildMessagesPerDaySeries(
      ["2026-06-01", "2026-06-01", "2026-06-03"],
      "2026-06-01",
      "2026-06-03"
    );

    expect(series).toEqual([
      { date: "2026-06-01", count: 2 },
      { date: "2026-06-02", count: 0 },
      { date: "2026-06-03", count: 1 },
    ]);
  });

  it("intervalo de um único dia devolve um único ponto", () => {
    const series = buildMessagesPerDaySeries(["2026-06-01"], "2026-06-01", "2026-06-01");
    expect(series).toEqual([{ date: "2026-06-01", count: 1 }]);
  });
});
