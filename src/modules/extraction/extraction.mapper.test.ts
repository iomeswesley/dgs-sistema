import { describe, expect, it } from "vitest";
import { mapExtraction } from "@/modules/extraction/extraction.mapper.js";
import type { ExtractedRow, ExtractionResult } from "@/modules/extraction/extraction.schema.js";

// Os dados abaixo são linhas reais das duas listas fotografadas (Indaial/SISREG
// e Penha/CELK), usadas como fixture para travar o comportamento contra o
// material de verdade em vez de exemplos inventados.

function row(overrides: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    name: "Paciente Teste",
    cns: null,
    birthDate: null,
    phones: ["(47) 99239-7649"],
    procedure: null,
    doctor: null,
    scheduledAt: "2026-07-23T13:00",
    requestingUnit: null,
    isFirstVisit: null,
    confidence: 1,
    notes: null,
    ...overrides,
  };
}

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    sourceFormat: "CELK",
    municipality: "Penha",
    executingUnit: "Policlínica",
    doctor: "Jesus Marcos Fabris Junior",
    procedure: "Ultrassonografia obstétrica",
    rows: [row()],
    warnings: [],
    ...overrides,
  };
}

describe("mapExtraction — cabeçalho preenche a linha", () => {
  it("herda médico e procedimento do cabeçalho quando a linha não traz", () => {
    const [draft] = mapExtraction(extraction()).drafts;
    expect(draft?.doctor).toBe("Jesus Marcos Fabris Junior");
    expect(draft?.procedure).toBe("Ultrassonografia obstétrica");
    expect(draft?.readyToSend).toBe(true);
  });

  it("a linha vence o cabeçalho quando traz o próprio valor", () => {
    // No CELK o procedimento vem por seção: a mesma lista tem ultrassom
    // obstétrico e de articulação.
    const mapped = mapExtraction(
      extraction({ rows: [row({ procedure: "Ultrassonografia de articulação" })] })
    );
    expect(mapped.drafts[0]?.procedure).toBe("Ultrassonografia de articulação");
  });

  it("aponta falta de médico e procedimento quando nem a linha nem o cabeçalho têm", () => {
    const mapped = mapExtraction(extraction({ doctor: null, procedure: null }));
    expect(mapped.drafts[0]?.issues).toContain("sem_medico");
    expect(mapped.drafts[0]?.issues).toContain("sem_procedimento");
    expect(mapped.drafts[0]?.readyToSend).toBe(false);
  });
});

describe("mapExtraction — telefones", () => {
  it("normaliza os vários telefones e escolhe o celular para o disparo", () => {
    // Linha real de Indaial: fixo primeiro, celular depois.
    const mapped = mapExtraction(
      extraction({ rows: [row({ phones: ["(47) 3380-4983", "(47) 99968-1919"] })] })
    );
    const draft = mapped.drafts[0];
    expect(draft?.phones).toEqual(["5547999681919", "554733804983"]);
    expect(draft?.dispatchPhone).toBe("5547999681919");
    expect(draft?.readyToSend).toBe(true);
  });

  it("marca telefone_invalido quando o paciente só tem fixo", () => {
    const mapped = mapExtraction(
      extraction({ rows: [row({ phones: ["(47) 3380-4983", "(47) 3209-3637"] })] })
    );
    const draft = mapped.drafts[0];
    expect(draft?.dispatchPhone).toBeNull();
    expect(draft?.issues).toContain("telefone_invalido");
    expect(draft?.readyToSend).toBe(false);
  });

  it("marca sem_telefone e mantém o paciente na lista", () => {
    const mapped = mapExtraction(extraction({ rows: [row({ phones: [] })] }));
    expect(mapped.drafts).toHaveLength(1); // não some do relatório
    expect(mapped.drafts[0]?.issues).toContain("sem_telefone");
    expect(mapped.summary.withoutPhone).toBe(1);
  });

  it("guarda o número inválido em vez de descartar em silêncio", () => {
    // Linha real de Penha: "(04) 73345-8381" — DDD 04 não existe.
    const mapped = mapExtraction(
      extraction({ rows: [row({ phones: ["(04) 73345-8381", "(47) 99700-1164"] })] })
    );
    const draft = mapped.drafts[0];
    expect(draft?.invalidPhones).toEqual(["(04) 73345-8381"]);
    expect(draft?.dispatchPhone).toBe("5547997001164");
    expect(draft?.issues).toContain("telefone_invalido");
  });
});

describe("mapExtraction — revisão humana", () => {
  it("destaca linha com confiança baixa", () => {
    const mapped = mapExtraction(extraction({ rows: [row({ confidence: 0.55 })] }));
    expect(mapped.drafts[0]?.issues).toContain("baixa_confianca");
    expect(mapped.drafts[0]?.readyToSend).toBe(false);
  });

  it("marca as duas ocorrências de um paciente duplicado, sem apagar nenhuma", () => {
    // Caso real de Penha: DEBORA ALVES GONCALVES FREITAS aparece duas vezes.
    const duplicate = row({ name: "Debora Alves Goncalves Freitas", phones: ["(47) 99685-8857"] });
    const mapped = mapExtraction(extraction({ rows: [duplicate, { ...duplicate }] }));

    expect(mapped.drafts).toHaveLength(2);
    expect(mapped.drafts[0]?.issues).toContain("duplicado");
    expect(mapped.drafts[1]?.issues).toContain("duplicado");
    expect(mapped.summary.readyToSend).toBe(0);
  });

  it("não confunde pacientes diferentes com o mesmo primeiro nome", () => {
    const mapped = mapExtraction(
      extraction({
        rows: [
          row({ name: "Ednalva Sabino de Oliveira", cns: "700001693876803" }),
          row({ name: "Ednalva Sabino de Oliveira", cns: "706705786157420" }),
        ],
      })
    );
    expect(mapped.drafts.every((draft) => !draft.issues.includes("duplicado"))).toBe(true);
  });

  it("aponta falta de data", () => {
    const mapped = mapExtraction(extraction({ rows: [row({ scheduledAt: null })] }));
    expect(mapped.drafts[0]?.issues).toContain("sem_data");
  });
});

describe("mapExtraction — resumo", () => {
  it("conta o que está pronto e o que precisa de revisão", () => {
    const mapped = mapExtraction(
      extraction({
        rows: [
          row({ name: "Mayalli Barreto Coelho", phones: ["(47) 99239-7649"] }),
          row({ name: "Nanci Franzen", phones: ["(47) 99150-9448"], confidence: 0.4 }),
          row({ name: "Marco Antonio Mendes", phones: [] }),
        ],
      })
    );

    expect(mapped.summary).toEqual({ total: 3, readyToSend: 1, needsReview: 2, withoutPhone: 1 });
  });

  it("repassa os avisos gerais da extração", () => {
    const mapped = mapExtraction(
      extraction({ warnings: ["Rodapé indica 3 páginas, apenas 1 foi recebida"] })
    );
    expect(mapped.warnings).toHaveLength(1);
  });
});
