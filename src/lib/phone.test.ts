import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, normalizePhoneList, pickDispatchPhone } from "@/lib/phone.js";

describe("normalizePhone", () => {
  it("normaliza celular formatado como nas listas das prefeituras", () => {
    expect(normalizePhone("(47) 99894-3232")?.e164).toBe("5547998943232");
    expect(normalizePhone("47 99894 3232")?.e164).toBe("5547998943232");
    expect(normalizePhone("47998943232")?.e164).toBe("5547998943232");
  });

  it("aceita número que já vem com DDI", () => {
    expect(normalizePhone("5547998943232")?.e164).toBe("5547998943232");
    expect(normalizePhone("+55 (47) 99894-3232")?.e164).toBe("5547998943232");
  });

  it("classifica fixo e celular", () => {
    expect(normalizePhone("(47) 3380-4983")?.kind).toBe("landline");
    expect(normalizePhone("(47) 99894-3232")?.kind).toBe("mobile");
  });

  it("não corta o DDI de um número do DDD 55", () => {
    // 55 99999-8888 em Santa Maria/RS: 11 dígitos nacionais começando com 55.
    const phone = normalizePhone("55999998888");
    expect(phone?.e164).toBe("5555999998888");
    expect(phone?.areaCode).toBe(55);
  });

  it("rejeita lixo de extração", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("25/06/2026")).toBeNull(); // data virou "telefone"
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("700001693876803")).toBeNull(); // CNS
    expect(normalizePhone("(00) 99999-8888")).toBeNull(); // DDD inexistente
    expect(normalizePhone("(47) 89894-3232")).toBeNull(); // celular sem o 9 inicial
  });

  it("rejeita celular antigo de 8 dígitos, que não dá pra reconstruir", () => {
    expect(normalizePhone("4798943232")).toBeNull();
  });
});

describe("normalizePhoneList", () => {
  it("remove duplicados e põe celulares na frente", () => {
    const list = normalizePhoneList([
      "(47) 3380-4983",
      "(47) 99968-1919",
      "47999681919", // mesmo número, outro formato
      "data inválida",
    ]);
    expect(list.map((p) => p.e164)).toEqual(["5547999681919", "554733804983"]);
  });

  it("preserva a ordem original dentro de cada tipo", () => {
    const list = normalizePhoneList(["(47) 99999-1111", "(47) 99999-2222"]);
    expect(list.map((p) => p.e164)).toEqual(["5547999991111", "5547999992222"]);
  });
});

describe("pickDispatchPhone", () => {
  it("escolhe o primeiro celular, ignorando fixos", () => {
    expect(pickDispatchPhone(["(47) 3380-4983", "(47) 99968-1919"])).toBe("5547999681919");
  });

  it("devolve null quando o paciente só tem fixo", () => {
    expect(pickDispatchPhone(["(47) 3380-4983", "(47) 3209-3637"])).toBeNull();
  });

  it("devolve null quando não há telefone nenhum", () => {
    expect(pickDispatchPhone([])).toBeNull();
    expect(pickDispatchPhone([null, "", "---"])).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formata celular e fixo pra exibição", () => {
    expect(formatPhone("5547998943232")).toBe("(47) 99894-3232");
    expect(formatPhone("554733804983")).toBe("(47) 3380-4983");
  });
});
