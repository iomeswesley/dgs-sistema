import { describe, expect, it } from "vitest";
import { applyTenantFilter } from "@/lib/tenant-prisma-extension.js";
import {
  MissingTenantContextError,
  currentClientIdOrThrow,
  requireActiveClientId,
  runAsSuperAdmin,
  runWithClient,
} from "@/lib/tenant-context.js";

describe("applyTenantFilter", () => {
  it("injeta clientId no where de leituras", () => {
    const out = applyTenantFilter("findMany", { where: { active: true } }, 7);
    expect(out?.where).toEqual({ active: true, clientId: 7 });
  });

  it("injeta clientId no where mesmo sem where nenhum", () => {
    const out = applyTenantFilter("findFirst", undefined, 7);
    expect(out?.where).toEqual({ clientId: 7 });
  });

  it("não deixa o valor da query sobrescrever o clientId injetado", () => {
    const out = applyTenantFilter("findMany", { where: { clientId: 999 } }, 7);
    expect(out?.where).toEqual({ clientId: 7 });
  });

  it("injeta clientId no data de create", () => {
    const out = applyTenantFilter("create", { data: { name: "X" } }, 7);
    expect(out?.data).toEqual({ name: "X", clientId: 7 });
  });

  it("injeta clientId em cada linha de createMany", () => {
    const out = applyTenantFilter(
      "createMany",
      { data: [{ name: "A" }, { name: "B" }] },
      7,
    );
    expect(out?.data).toEqual([
      { name: "A", clientId: 7 },
      { name: "B", clientId: 7 },
    ]);
  });

  it("injeta clientId no where e no create de upsert", () => {
    const out = applyTenantFilter(
      "upsert",
      { where: { id: 1 }, create: { name: "X" }, update: { name: "Y" } },
      7,
    );
    expect(out?.where).toEqual({ id: 1, clientId: 7 });
    expect(out?.create).toEqual({ name: "X", clientId: 7 });
    // update não recebe clientId — updates não podem trocar o dono da linha.
    expect(out?.update).toEqual({ name: "Y" });
  });

  it("injeta clientId no where de update/delete", () => {
    expect(applyTenantFilter("update", { where: { id: 1 } }, 7)?.where).toEqual({
      id: 1,
      clientId: 7,
    });
    expect(applyTenantFilter("delete", { where: { id: 1 } }, 7)?.where).toEqual({
      id: 1,
      clientId: 7,
    });
  });

  it("super admin (clientId null) passa os args sem modificar", () => {
    const args = { where: { active: true } };
    expect(applyTenantFilter("findMany", args, null)).toBe(args);
  });
});

describe("tenant-context", () => {
  it("lança fail-closed sem contexto nenhum", () => {
    expect(() => currentClientIdOrThrow("Patient")).toThrow(MissingTenantContextError);
  });

  it("runWithClient expõe o clientId ativo dentro do escopo", () => {
    runWithClient(42, () => {
      expect(currentClientIdOrThrow("Patient")).toBe(42);
      expect(requireActiveClientId()).toBe(42);
    });
  });

  it("fora do runWithClient, o contexto não vaza pra chamada seguinte", () => {
    runWithClient(42, () => {});
    expect(() => currentClientIdOrThrow("Patient")).toThrow(MissingTenantContextError);
  });

  it("runAsSuperAdmin devolve null (não injeta filtro)", () => {
    runAsSuperAdmin(() => {
      expect(currentClientIdOrThrow("Patient")).toBeNull();
    });
  });

  it("requireActiveClientId lança dentro de runAsSuperAdmin (sem cliente único)", () => {
    runAsSuperAdmin(() => {
      expect(() => requireActiveClientId()).toThrow();
    });
  });

  it("contexto isola chamadas concorrentes (AsyncLocalStorage não vaza entre elas)", async () => {
    const results: number[] = [];
    await Promise.all([
      runWithClient(1, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(currentClientIdOrThrow("Patient") as number);
      }),
      runWithClient(2, async () => {
        results.push(currentClientIdOrThrow("Patient") as number);
      }),
    ]);
    expect(results.sort()).toEqual([1, 2]);
  });
});
