/*
  Testa a extração num arquivo real, sem precisar do painel nem do banco.

    npx tsx scripts/extrair.ts caminho/da/lista.pdf

  Serve para calibrar os parsers (SISREG/CELK) contra listas novas: mostra o
  que foi lido, o que ficou duvidoso e o que impede o disparo — a mesma
  leitura que a tela de revisão vai mostrar. Extração é local, sem API —
  não precisa de `--env-file=.env` nem de chave nenhuma pra rodar isto.
*/

import fs from "node:fs";
import path from "node:path";
import { extractList } from "@/modules/extraction/extraction.service.js";
import { mapExtraction } from "@/modules/extraction/extraction.mapper.js";
import { formatPhone } from "@/lib/phone.js";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Uso: npx tsx scripts/extrair.ts <arquivo.pdf>");
    process.exit(1);
  }

  if (path.extname(filePath).toLowerCase() !== ".pdf") {
    console.error("Só PDF é suportado — a extração não lê mais foto.");
    process.exit(1);
  }
  const mimeType = "application/pdf";

  const file = fs.readFileSync(filePath);
  console.log(`Lendo ${path.basename(filePath)} (${(file.length / 1024).toFixed(0)} KB)…\n`);

  const started = Date.now();
  const { result } = await extractList(file, mimeType);
  const mapped = mapExtraction(result);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Formato reconhecido: ${mapped.sourceFormat}`);
  console.log(`Município: ${mapped.municipality ?? "—"}`);
  console.log(`Unidade: ${mapped.executingUnit ?? "—"}`);
  console.log(`Médico: ${mapped.doctor ?? "(por linha)"}`);
  console.log(`Procedimento: ${mapped.procedure ?? "(por linha)"}\n`);

  if (mapped.warnings.length > 0) {
    console.log("Avisos:");
    for (const warning of mapped.warnings) console.log(`  ! ${warning}`);
    console.log();
  }

  for (const draft of mapped.drafts) {
    const mark = draft.readyToSend ? "✓" : "!";
    const phone = draft.dispatchPhone ? formatPhone(draft.dispatchPhone) : "sem celular";
    console.log(`${mark} ${String(draft.index + 1).padStart(3)} ${draft.name}`);
    console.log(`      ${phone} · ${draft.scheduledAt ?? "sem data"} · ${draft.procedure ?? "sem procedimento"}`);
    if (draft.issues.length > 0) console.log(`      pendências: ${draft.issues.join(", ")}`);
    if (draft.confidence < 1) console.log(`      confiança: ${draft.confidence.toFixed(2)}`);
    if (draft.notes) console.log(`      nota: ${draft.notes}`);
  }

  const { total, readyToSend, needsReview, withoutPhone } = mapped.summary;
  console.log(`\n${total} pacientes · ${readyToSend} prontos · ${needsReview} para revisar · ${withoutPhone} sem telefone`);
  console.log(`${seconds}s · leitura local, sem API`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
