import { describe, expect, it } from "vitest";
import { buildReplyClassificationPrompt } from "@/modules/replies/replies.prompt.js";

describe("buildReplyClassificationPrompt", () => {
  it("inclui o texto do paciente entre aspas", () => {
    expect(buildReplyClassificationPrompt("acho que vou sim")).toContain('"acho que vou sim"');
  });

  it("preserva aspas dentro do próprio texto sem quebrar a citação", () => {
    const prompt = buildReplyClassificationPrompt('ela disse "não sei ainda"');
    expect(prompt).toContain('ela disse "não sei ainda"');
  });
});
