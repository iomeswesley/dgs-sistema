/**
 * Auditoria: "telefone inválido"/"sem telefone" preso em `rawLine.issues`
 * mesmo depois do telefone já ter sido corrigido por "Corrigir telefone" ou
 * "Reenviar pra quem falhou" (retryFailedAppointments) — bug achado em
 * produção em 2026-09-04: esse caminho nunca chamava `clearResolvedIssues`,
 * diferente de `editAppointment` ("Corrigir" completo, só em EM_REVISAO).
 * Já corrigido na raiz em `lists.service.ts`; este script limpa o que já
 * ficou preso antes do fix.
 *
 * Critério: `rawLine.issues` contém "telefone_invalido" ou "sem_telefone",
 * mas `selectedPhone` atual já é um celular válido (E.164, 13 dígitos,
 * começa 55<ddd>9). Não mexe em mais nada — só tira esses dois avisos
 * específicos (e limpa `invalidPhones`, mesma lógica de `clearResolvedIssues`).
 *
 * Dry-run por padrão. `--apply` grava de verdade.
 */
import { prisma } from "../src/lib/prisma.js";
import { runWithClient } from "../src/lib/tenant-context.js";

const APPLY = process.argv.includes("--apply");

function isValidMobile(phone: string | null): boolean {
  return !!phone && /^55\d{2}9\d{8}$/.test(phone);
}

async function main() {
  await runWithClient(1, async () => {
    const candidates = await prisma.appointment.findMany({
      where: {
        OR: [
          { rawLine: { path: ["issues"], array_contains: "telefone_invalido" } },
          { rawLine: { path: ["issues"], array_contains: "sem_telefone" } },
        ],
      },
      select: { id: true, selectedPhone: true, rawLine: true, patient: { select: { name: true } } },
    });

    let fixed = 0;
    for (const appointment of candidates) {
      if (!isValidMobile(appointment.selectedPhone)) continue; // ainda não corrigido de verdade

      const rawLine = appointment.rawLine as {
        issues?: string[];
        invalidPhones?: string[];
        notes?: string | null;
        executingUnit?: string | null;
      } | null;
      if (!rawLine) continue;

      const issues = (rawLine.issues ?? []).filter((i) => i !== "telefone_invalido" && i !== "sem_telefone");
      if (issues.length === (rawLine.issues ?? []).length) continue; // nada mudou

      fixed++;
      console.log(
        `${APPLY ? "[corrigindo]" : "[dry-run]"} #${appointment.id} ${appointment.patient.name} — ` +
          `selectedPhone=${appointment.selectedPhone}, issues ${JSON.stringify(rawLine.issues)} -> ${JSON.stringify(issues)}`
      );

      if (APPLY) {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { rawLine: { ...rawLine, issues, invalidPhones: [] } },
        });
      }
    }

    console.log(`\n${fixed} agendamento(s) ${APPLY ? "corrigido(s)" : "encontrado(s) (rode com --apply pra corrigir)"}.`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
