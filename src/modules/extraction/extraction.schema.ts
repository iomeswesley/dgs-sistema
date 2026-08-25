import { z } from "zod";

/*
  Formato do que a IA devolve ao ler uma lista.

  Dois níveis, porque é assim que as listas reais são: o cabeçalho traz os
  dados da agenda inteira (médico, procedimento, unidade, período) e as linhas
  trazem os pacientes. No CELK o procedimento ainda vem por seção, não por
  linha — daí `procedure` existir nos dois níveis.
*/

export const extractedRowSchema = z.object({
  /** Nome do paciente exatamente como está no documento. */
  name: z.string(),
  /** Cartão Nacional de Saúde, quando a lista traz. */
  cns: z.string().nullable(),
  /** Nascimento em AAAA-MM-DD, quando legível. */
  birthDate: z.string().nullable(),
  /** Todos os telefones da linha, como aparecem (sem normalizar). */
  phones: z.array(z.string()),
  /** Procedimento da linha; null quando vem da seção ou do cabeçalho. */
  procedure: z.string().nullable(),
  /** Médico da linha; null quando vem do cabeçalho. */
  doctor: z.string().nullable(),
  /** Data e hora do atendimento em AAAA-MM-DDTHH:MM. */
  scheduledAt: z.string().nullable(),
  /** Unidade que encaminhou o paciente (UBS de origem). */
  requestingUnit: z.string().nullable(),
  /** true = 1ª vez, false = retorno, null = não informado. */
  isFirstVisit: z.boolean().nullable(),
  /** 0 a 1. Abaixo de 0,8 a linha aparece destacada na revisão. */
  confidence: z.number(),
  /** O que ficou ilegível ou duvidoso nesta linha. */
  notes: z.string().nullable(),
});

/**
 * Registro que o parser não conseguiu reconhecer de jeito nenhum
 * ("Registro não reconhecido") — pra pré-preencher o formulário de
 * "Adicionar paciente manualmente" com o que der pra aproveitar em vez de
 * começar em branco. `rawText` é o texto bruto do registro inteiro, sempre
 * presente (pra equipe conferir/copiar o que o palpite não pegou); os
 * demais campos são melhor-esforço, `null`/vazio quando não achou nada com
 * confiança nenhuma — nunca inventa valor.
 */
export const unrecognizedGuessSchema = z.object({
  rawText: z.string(),
  name: z.string().nullable(),
  cns: z.string().nullable(),
  birthDate: z.string().nullable(),
  phones: z.array(z.string()),
});

export const extractionResultSchema = z.object({
  /** Sistema de origem reconhecido pelo layout. */
  sourceFormat: z.enum(["SISREG", "CELK", "OUTRO"]),
  /** Município/prefeitura, quando identificável no documento. */
  municipality: z.string().nullable(),
  /** Unidade onde o atendimento acontece. */
  executingUnit: z.string().nullable(),
  /** Médico do cabeçalho, quando a lista inteira é de um só profissional. */
  doctor: z.string().nullable(),
  /** Procedimento do cabeçalho, quando a lista inteira é de um só. */
  procedure: z.string().nullable(),
  rows: z.array(extractedRowSchema),
  /** Problemas gerais: página cortada, foto tremida, coluna ilegível. */
  warnings: z.array(z.string()),
  /** Um item por "Registro não reconhecido" em `warnings`, na mesma ordem. */
  unrecognized: z.array(unrecognizedGuessSchema).default([]),
});

export type ExtractedRow = z.infer<typeof extractedRowSchema>;
export type UnrecognizedGuess = z.infer<typeof unrecognizedGuessSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
