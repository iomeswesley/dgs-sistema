import { describe, expect, it } from "vitest";
import {
  buildIndicatorsCore,
  buildMessagesPerDaySeries,
  buildReceivedFlowBreakdown,
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
    // Por padrão, "teve o template de confirmação enviado" — a maioria dos
    // testes acima não se importa com a taxa de confirmação especificamente
    // e não deveria precisar declarar isso toda vez.
    isComplementary: false,
    confirmationTemplateSent: true,
    manuallyContacted: false,
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

  it("% Confirmação = confirmados ÷ templates de confirmação enviados (ou contato manual), não ÷ contatáveis", () => {
    // Achado pelo usuário em 2026-09-03: a fórmula antiga (confirmados ÷
    // contatáveis) misturava quem nunca teve NENHUMA tentativa de
    // confirmar no denominador — derrubava a taxa sem representar
    // confirmação perdida de verdade.
    const appointments = [
      appointment({ status: "CONFIRMADO", confirmationTemplateSent: true }),
      appointment({ status: "CONFIRMADO", confirmationTemplateSent: true }),
      appointment({ status: "SEM_RESPOSTA", confirmationTemplateSent: true }),
      // Nunca foi disparada (lista ainda em revisão) — tem telefone (é
      // "contatável"), mas nenhuma tentativa real de confirmar ainda.
      // Não pode entrar no denominador, senão a taxa cai por causa de algo
      // que nem foi tentado.
      appointment({ status: "PENDENTE", confirmationTemplateSent: false, manuallyContacted: false }),
    ];
    const { totals } = buildIndicatorsCore(appointments, [], [], "doctor");

    expect(totals.confirmationBase).toBe(3);
    expect(totals.confirmationConfirmed).toBe(2);
    expect(totals.confirmationRate).toBeCloseTo(2 / 3);
  });

  it("contato manual da equipe conta como tentativa de confirmar, mesmo sem template enviado", () => {
    const appointments = [
      appointment({ status: "CONFIRMADO", confirmationTemplateSent: false, manuallyContacted: true }),
      appointment({ status: "SEM_TELEFONE", confirmationTemplateSent: false, manuallyContacted: false }),
    ];
    const { totals } = buildIndicatorsCore(appointments, [], [], "doctor");

    expect(totals.confirmationBase).toBe(1);
    expect(totals.confirmationConfirmed).toBe(1);
    expect(totals.confirmationRate).toBe(1);
  });

  it("agendamento de reposição de vaga (VAGA_ABERTA) fica fora da % Confirmação — fluxo diferente", () => {
    const appointments = [
      appointment({ status: "CONFIRMADO", isComplementary: true, confirmationTemplateSent: false }),
      appointment({ status: "CONFIRMADO", isComplementary: false, confirmationTemplateSent: true }),
    ];
    const { totals } = buildIndicatorsCore(appointments, [], [], "doctor");

    expect(totals.confirmationBase).toBe(1);
    expect(totals.confirmationConfirmed).toBe(1);
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

const NO_TEMPLATES = { CONFIRMACAO: 0, LEMBRETE: 0, VAGA_ABERTA: 0, CANCELAMENTO: 0 };

describe("buildMessagesPerDaySeries", () => {
  it("preenche com 0 os dias sem envio dentro do intervalo, e soma por template", () => {
    const series = buildMessagesPerDaySeries(
      [
        { dayKey: "2026-06-01", template: "CONFIRMACAO" },
        { dayKey: "2026-06-01", template: "LEMBRETE" },
        { dayKey: "2026-06-03", template: "CONFIRMACAO" },
      ],
      "2026-06-01",
      "2026-06-03"
    );

    expect(series).toEqual([
      { date: "2026-06-01", count: 2, byTemplate: { ...NO_TEMPLATES, CONFIRMACAO: 1, LEMBRETE: 1 } },
      { date: "2026-06-02", count: 0, byTemplate: NO_TEMPLATES },
      { date: "2026-06-03", count: 1, byTemplate: { ...NO_TEMPLATES, CONFIRMACAO: 1 } },
    ]);
  });

  it("intervalo de um único dia devolve um único ponto", () => {
    const series = buildMessagesPerDaySeries(
      [{ dayKey: "2026-06-01", template: "VAGA_ABERTA" }],
      "2026-06-01",
      "2026-06-01"
    );
    expect(series).toEqual([
      { date: "2026-06-01", count: 1, byTemplate: { ...NO_TEMPLATES, VAGA_ABERTA: 1 } },
    ]);
  });

  it("mensagem sem template (texto livre avulso) soma no total do dia, mas em nenhuma barra", () => {
    const series = buildMessagesPerDaySeries([{ dayKey: "2026-06-01", template: null }], "2026-06-01", "2026-06-01");
    expect(series).toEqual([{ date: "2026-06-01", count: 1, byTemplate: NO_TEMPLATES }]);
  });
});

describe("buildReceivedFlowBreakdown", () => {
  it("separa confirmação de consulta e reposição de vaga, contando por status", () => {
    const { confirmacao, vagaAberta } = buildReceivedFlowBreakdown([
      { status: "CONFIRMADO", isComplementary: false },
      { status: "RECUSADO", isComplementary: false },
      { status: "CONFIRMADO", isComplementary: true },
      { status: "SEM_RESPOSTA", isComplementary: true },
    ]);

    expect(confirmacao.CONFIRMADO).toBe(1);
    expect(confirmacao.RECUSADO).toBe(1);
    expect(vagaAberta.CONFIRMADO).toBe(1);
    expect(vagaAberta.SEM_RESPOSTA).toBe(1);
    // Não vaza entre os dois fluxos.
    expect(confirmacao.SEM_RESPOSTA).toBe(0);
    expect(vagaAberta.RECUSADO).toBe(0);
  });
});
