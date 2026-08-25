import type { ExtractedRow, ExtractionResult } from "../extraction.schema.js";
import { extractPhones, parseVaga, toIsoDate, toIsoDateTime } from "./shared.js";

/*
  O SISREG quebra cada célula da tabela em uma linha de texto separada, sem
  preservar alinhamento de coluna — nome em duas linhas, telefone cortado no
  meio do hífen, etc. Tentar reconstruir pela posição das linhas é frágil e
  muda de prefeitura pra prefeitura.

  A abordagem aqui é outra: junta tudo em uma linha por registro (do número
  de solicitação até o próximo) e vai consumindo do início ao fim por
  padrão de campo — CNS são sempre 15 dígitos, nascimento é sempre
  DD/MM/AAAA, "vaga" é sempre "1ª VEZ" ou "RETORNO" etc. — em vez de por
  posição. Isso tolera colunas que existem em algumas listas e não em
  outras (ex.: "Nome Social", "Procedimento" por linha).

  CID-10 é lido só pra saber onde o registro termina — nunca fica no
  resultado (dado sensível, LGPD, não pode ir pra mensagem de WhatsApp).
*/

// O código de solicitação geralmente fica sozinho na linha, mas às vezes
// vem com o dia da semana colado por tab na mesma linha ("656278209\tSAB")
// — por isso o fim da linha não é exigido, só que ela comece com os dígitos.
const RECORD_START = /^\d{6,10}(\s|$)/;

export function parseSisreg(text: string): ExtractionResult {
  const rawLines = text.split("\n").map((line) => line.trim());
  const warnings: string[] = [];

  // O SISREG não tem um campo "Município" no cabeçalho — só aparece na
  // coluna "Origem" de cada linha ("INDAIAL - SC"), sem estar isolado no
  // início de uma linha de texto (fica colado à idade). Por isso a busca é
  // livre no texto inteiro, não ancorada.
  const municipalityMatch = text.match(/\b([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ]+(?:\s[A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ]+)*)\s*-\s*SC\b/);
  // Duas variantes de cabeçalho vistas em listas reais: uma rotula
  // "Unidade Executante:" explicitamente, outra só põe o nome da unidade
  // direto na linha seguinte a "PROPRIEDADES DA AGENDA".
  const unitMatch =
    text.match(/Unidade\s+Executante:\s*([^\n(]+?)\s*\(\d+\)/i) ??
    text.match(/PROPRIEDADES DA AGENDA\s*\n+\s*([^\n(]+?)\s*\(\d+\)/i);
  const doctorMatch = text.match(/Profissional\s+Executante:\s*([^\n(]+)/i);
  const procedureMatch = text.match(/Procedimento\s+Ambulatorial:\s*([^\n(]+)/i);

  // Agrupa as linhas de cada registro: do início (número de solicitação
  // sozinho na linha) até a linha anterior ao próximo registro.
  const recordChunks: string[][] = [];
  let current: string[] | null = null;
  for (const line of rawLines) {
    if (RECORD_START.test(line)) {
      if (current) recordChunks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) recordChunks.push(current);

  const rows: ExtractedRow[] = [];
  for (const chunk of recordChunks) {
    const row = parseRecord(chunk);
    if (row) rows.push(row);
    else warnings.push(`Registro não reconhecido (começa com "${chunk[0]}") — confira manualmente.`);
  }

  if (rows.length === 0) {
    warnings.push("Nenhuma linha de paciente reconhecida no formato SISREG — confira o arquivo manualmente.");
  }

  return {
    sourceFormat: "SISREG",
    municipality: municipalityMatch?.[1]?.trim() ?? null,
    executingUnit: unitMatch?.[1]?.trim() ?? null,
    doctor: doctorMatch?.[1]?.trim() ?? null,
    procedure: procedureMatch?.[1]?.trim() ?? null,
    rows,
    warnings,
  };
}

// "Nome Social" costuma vir "---" (vazio) quando o paciente não tem um nome
// social distinto do nome civil — mas achado em 2026-08-26 (lista 11): em
// alguns registros o SISREG repete o nome civil ali em vez de "---", e como
// o parser junta "Nome" + "Nome Social" numa string só antes do nascimento,
// o resultado saía com o nome duas vezes ("FULANA DE TAL FULANA DE TAL").
// Colapsa quando a segunda metade das palavras é idêntica, palavra por
// palavra, à primeira — não afeta nome real nenhum (não existe nome de
// pessoa formado pela repetição exata do próprio nome inteiro).
function dedupeRepeatedName(name: string): string {
  const words = name.split(/\s+/);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const first = words.slice(0, half).join(" ");
    const second = words.slice(half).join(" ");
    if (first && first === second) return first;
  }
  return name;
}

function parseRecord(chunk: string[]): ExtractedRow | null {
  // Junta as linhas do registro numa string só. Telefone às vezes é cortado
  // logo depois do hífen ("3387-" / "2221") — sem isso o número reconstruído
  // ficaria com um espaço no meio e falharia na normalização.
  let text = chunk
    .join(" ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/(\d)-\s+(\d{4})\b/g, "$1-$2");

  // codSolic + dia da semana + data + hora, sempre nessa ordem no início —
  // mas a hora às vezes falta de verdade no PDF (achado em 2026-08-26: duas
  // linhas de uma lista real não tinham hora nenhuma entre a data e o CNS,
  // rejeitava o registro inteiro e o paciente sumia da lista sem deixar
  // rastro). Hora agora é opcional aqui — sem ela, `scheduledAt` sai `null`
  // e a linha entra na revisão marcada "sem_data" (mesmo tratamento que
  // outros campos ausentes já recebem), em vez de desaparecer.
  const headMatch = text.match(/^\d{6,10}\s+[A-ZÇ]{3}\s+(\d{2}\/\d{2}\/\d{4})\s+(?:(\d{2}:\d{2})\s+)?(.*)$/i);
  if (!headMatch) return null;
  const [, dateBr, time, rest] = headMatch;
  if (!dateBr) return null;
  let remainder = rest ?? "";

  // CNS: 15 dígitos, tolerando um espaço perdido no meio (quando a quebra
  // de linha caiu bem no meio do número).
  const cnsMatch = remainder.match(/^((?:\d\s?){15})\s*(.*)$/);
  const cns = cnsMatch?.[1] ? cnsMatch[1].replace(/\s/g, "") : null;
  if (cnsMatch) remainder = cnsMatch[2] ?? "";

  // Nome: tudo até o nascimento (DD/MM/AAAA, também tolerando o mesmo tipo
  // de quebra no último dígito do ano). O que sobra ali no meio costuma ser
  // "Nome Social" vazio ("---") quando a lista tem essa coluna.
  const birthMatch = remainder.match(/^(.*?)(\d{2}\/\d{2}\/\d{3})\s?(\d)\b\s*(.*)$/);
  if (!birthMatch) return null;
  const [, namePart, birthHead, birthTail, afterBirth] = birthMatch;
  if (!namePart || !birthHead || !birthTail) return null;
  const name = dedupeRepeatedName(namePart.replace(/-{2,}\s*$/, "").trim());
  const birthDate = toIsoDate(`${birthHead}${birthTail}`);
  remainder = afterBirth ?? "";

  // Idade: 1-3 dígitos logo após o nascimento. Só usada pra avançar o
  // cursor — o paciente já tem `birthDate`, que é o dado confiável.
  const ageMatch = remainder.match(/^(\d{1,3})\s+(.*)$/);
  if (ageMatch) remainder = ageMatch[2] ?? "";

  // Origem: "CIDADE - UF". Só avança o cursor, não entra no resultado (a
  // lista já é de um único município, cadastrado na tela de Listas).
  const originMatch = remainder.match(/^([A-ZÀ-Ýa-zà-ÿ\s]+?)\s*-\s*([A-Z]{2})\s+(.*)$/);
  if (originMatch) remainder = originMatch[3] ?? "";

  const phones = extractPhones(remainder);
  // Tira os telefones já capturados antes de seguir, senão eles atrapalham
  // o corte de CID-10/vaga/unidade que vem a seguir.
  for (const phone of phones) remainder = remainder.replace(phone, " ");
  remainder = remainder.replace(/\s+/g, " ").trim();

  // CID-10 sempre no fim: uma letra seguida de 2 a 4 dígitos. Lido só pra
  // saber onde o registro acaba — nunca entra no resultado (LGPD).
  remainder = remainder.replace(/\s+[A-Z]\d{2,4}\s*$/, "").trim();

  const isFirstVisit = parseVaga(remainder);
  const vagaMatch = remainder.match(/1\s*[ªa]\s*VEZ|RETOR\s*NO/i);
  const requestingUnit = (vagaMatch ? remainder.slice(0, vagaMatch.index) : remainder).trim() || null;

  return {
    name,
    cns,
    birthDate,
    phones,
    procedure: null,
    doctor: null,
    scheduledAt: time ? toIsoDateTime(dateBr, time) : null,
    requestingUnit,
    isFirstVisit,
    confidence: cns && birthDate && time ? 1 : 0.6,
    notes:
      !cns || !birthDate
        ? "CNS ou nascimento não reconhecidos com segurança — confira no arquivo."
        : !time
          ? "O PDF não trazia horário pra esse paciente — preencha antes de aprovar."
          : null,
  };
}
