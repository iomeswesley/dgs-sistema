import type { ExtractedRow, ExtractionResult } from "../extraction.schema.js";
import { extractPhones, toIsoDate, toIsoDateTime } from "./shared.js";

/*
  Formato "TABULAR" — achado pela primeira vez em 2026-09-16 (lista de
  Botuverá): uma linha de texto por paciente, direta, parecida com o CELK
  na estrutura (sem fragmentação multi-linha como o SISREG de verdade), só
  que com colunas diferentes — inclusive um cabeçalho "SISREG" na primeira
  coluna (é só o código de solicitação, não quer dizer que o arquivo é o
  formato SISREG de verdade; por isso `detectFormat()` checa esse cabeçalho
  ANTES do teste genérico de "contém a palavra SISREG").

    <linha> [código de solicitação] <NOME> <DD/MM/AAAA nascimento> <telefone> <PROCEDIMENTO> <DD/MM/AAAA> <HH:MM> [observação]

  Sem cabeçalho de agenda nenhum (sem município, unidade nem médico em
  lugar nenhum do arquivo) — diferente do CELK/SISREG, que trazem isso no
  topo/rodapé. Município e médico ficam por conta de quem sobe a lista
  (não tem como adivinhar); é o comportamento esperado aqui, não uma falha
  do parser.
*/

// Não ancora as pontas com "$"/"^" sozinho por causa do nome (pode ter
// qualquer palavra) — em vez disso, ancora nos dois pedaços que SEMPRE têm
// formato fixo: a data de nascimento logo depois do nome, e a data+hora do
// atendimento no fim (antes de uma observação opcional).
//
// `(?:\d+\s+)?` antes do nome: achado em 2026-09-24 (lista de Psiquiatria
// de Dr Pedrinho/Botuverá) — esse arquivo tem DUAS colunas numéricas antes
// do nome (número da linha + código de solicitação do SISREG de verdade,
// ex.: "1 \t676792725 \tKENIA..."), diferente do Botuverá original de
// 2026-09-16 (só o número da linha). Sem esse grupo, `name` (lazy) engolia
// o código de solicitação inteiro por engano ("676792725 \tKENIA..."),
// porque não havia nada de fixo pra parar o `.+?` antes dele. `name` agora
// exige começar com letra (mesma convenção de `BARE_PROCEDURE` abaixo) —
// código de solicitação é sempre dígito puro, nunca colide.
const ROW_PATTERN =
  /^\d+\s+(?:\d+\s+)?(?<name>[A-ZÀ-ÖØ-Þ].+?)\s+(?<birth>\d{2}\/\d{2}\/\d{4})\s+(?<rest>.+?)\s+(?<date>\d{2}\/\d{2}\/\d{4})\s+(?<time>\d{2}:\d{2})\s*(?<obs>.*)$/;

// Dentro de `rest` (telefone + procedimento grudados), o telefone é só
// dígitos/parênteses/hífen/ponto/espaço — o procedimento sempre começa com
// letra maiúscula logo depois... exceto quando vem com o código do SISREG
// na frente ("01 - ULTRA-SONOGRAFIA..."), achado em 2026-09-16 (lista de
// Pomerode, um PDF sem camada de texto que precisou ser retranscrito nesse
// mesmo formato): o "01 -" ficava ambíguo com o fim do telefone (os dois
// são dígito+traço), e sem esse caso a linha inteira ficava sem
// procedimento nenhum. O grupo opcional cobre esse prefixo sem quebrar o
// caso sem prefixo (ex.: Botuverá, "CONSULTA EM ORTOPEDIA..." direto).
// Não usa `extractPhones()` aqui porque o telefone às vezes vem com os
// dígitos quebrados por espaço em posições que `PHONE_RAW` (dígitos
// contíguos) não reconhece (ex.: "47 9840 05251").
const PHONE_THEN_PROCEDURE = /^(?<phone>[\d()\-.\s]+?\d)\s+(?<procedure>(?:\d+\s*-\s*)?[A-ZÀ-ÖØ-Þ].*)$/;

// `rest` sem telefone nenhum, ou com 2+ telefones (achado real em
// 2026-09-17, lista de Pomerode 19/09 — várias linhas trazem 2 ou 3
// telefones separados por "/") — nos dois casos `PHONE_THEN_PROCEDURE`
// não bate (só reconhece exatamente 1 telefone antes do procedimento) e,
// sem tratar à parte, o procedimento inteiro se perdia (virava `null`) por
// causa só da contagem de telefones, o que não devia acontecer — quantos
// telefones tem e qual é o procedimento são coisas independentes.
const BARE_PROCEDURE = /^(?:\d+\s*-\s*)?[A-ZÀ-ÖØ-Þ].*$/;

export function parseTabular(text: string): ExtractionResult {
  const lines = text.split("\n").map((line) => line.trimEnd());
  const warnings: string[] = [];
  const rows: ExtractedRow[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const match = line.match(ROW_PATTERN);
    if (!match?.groups) continue; // cabeçalho da tabela, rodapé, ou vaga sem paciente

    const { name, birth, rest, date, time } = match.groups;
    if (!name || !rest || !date || !time) continue;

    const split = rest.match(PHONE_THEN_PROCEDURE);
    // Telefone já isolado por `PHONE_THEN_PROCEDURE` — guarda como veio
    // (com espaço, parêntese, hífen, o que for): `normalizePhone()` limpa
    // tudo que não é dígito mais adiante (`extraction.mapper.ts`), então
    // não precisa (nem pode) tentar validar formato aqui. `extractPhones()`
    // não serve pra isso — ela exige dígitos contíguos ou já formatados, e
    // esse arquivo às vezes quebra o número em pedaços por espaço (ex.:
    // "47 9840 05251"), sem hífen nenhum.
    let phones: string[];
    let procedure: string | null;
    if (split) {
      phones = [split.groups!.phone!.trim()];
      procedure = split.groups!.procedure!.trim();
    } else {
      // 0, ou 2+, telefones — extrai TODOS os telefones formatados do
      // trecho (mesmo `extractPhones()` do CELK) e usa o que sobra, depois
      // de tirar cada telefone achado e qualquer "/" separando-os, como
      // procedimento — quando o que sobra ainda parece procedimento de
      // verdade. Cobre "sem telefone nenhum" (nada extraído, sobra é o
      // próprio `rest`) e "dois ou mais telefones juntos" com o mesmo
      // caminho, sem duplicar lógica pros dois casos.
      const extracted = extractPhones(rest);
      const remainder = extracted
        .reduce((acc, phone) => acc.split(phone).join(" "), rest)
        .replace(/\//g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (BARE_PROCEDURE.test(remainder)) {
        phones = extracted;
        procedure = remainder;
      } else {
        // Sem separação clara telefone/procedimento reconhecida: melhor-
        // esforço com o que `extractPhones()` achou, em vez de perder a
        // linha inteira — o procedimento fica null (linha entra em revisão
        // como "sem_procedimento", não desaparece da lista).
        phones = extracted;
        procedure = null;
      }
    }

    rows.push({
      name: name.trim(),
      cns: null,
      birthDate: birth ? toIsoDate(birth) : null,
      phones,
      procedure,
      doctor: null, // nunca vem no arquivo — quem sobe a lista escolhe (ver comentário no topo)
      scheduledAt: toIsoDateTime(date, time),
      requestingUnit: null,
      isFirstVisit: null,
      // Determinístico: 1 quando a linha bateu certinho no formato esperado.
      confidence: 1,
      notes: null,
    });
  }

  if (rows.length === 0) {
    warnings.push("Nenhuma linha de paciente reconhecida no formato tabular — confira o arquivo manualmente.");
  }

  return {
    sourceFormat: "TABULAR",
    municipality: null,
    executingUnit: null,
    doctor: null,
    procedure: null,
    rows,
    warnings,
    // Uma linha de texto por paciente, sem quebra de página no meio — não
    // tem "registro não reconhecido" com dado pra aproveitar, só a linha
    // inteira ilegível ou nada (mesma lógica do CELK).
    unrecognized: [],
  };
}
