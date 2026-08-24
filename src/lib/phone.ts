// Normalização de telefone brasileiro para E.164.
//
// As listas das prefeituras trazem os números em formatos variados —
// "(47) 99894-3232", "47998943232", "4733803637" — e até 5 colunas por
// paciente. Escolher bem o número faz diferença direta na taxa de entrega,
// então este módulo é puro (sem env, sem banco) e coberto por testes.

const BR_COUNTRY_CODE = "55";

// DDDs válidos no Brasil. Serve pra descartar lixo de extração (uma data ou
// um CNS truncado que virou "telefone") antes de tentar enviar.
const VALID_AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type PhoneKind = "mobile" | "landline";

export interface NormalizedPhone {
  /** E.164 sem o "+", como a Cloud API espera: 5547998943232 */
  e164: string;
  areaCode: number;
  kind: PhoneKind;
}

/**
 * Converte um telefone escrito de qualquer jeito para E.164, ou devolve null
 * se o número não for discável no Brasil.
 *
 * Aceita com ou sem DDI 55, com ou sem o nono dígito. Celular = 9 dígitos
 * começando com 9; fixo = 8 dígitos começando de 2 a 5. Celular de 8 dígitos
 * (sem o nono) é reconstruído sozinho — ver comentário mais abaixo.
 */
export function normalizePhone(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;

  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // Remove o DDI quando presente. Só corta se o que sobrar tiver tamanho de
  // número nacional — evita mutilar um número que por acaso comece com 55
  // (DDD 55 é Santa Maria/RS e é legítimo).
  if (digits.startsWith(BR_COUNTRY_CODE) && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(BR_COUNTRY_CODE.length);
  }

  if (digits.length !== 10 && digits.length !== 11) return null;

  const areaCode = Number(digits.slice(0, 2));
  if (!VALID_AREA_CODES.has(areaCode)) return null;

  const subscriber = digits.slice(2);
  const first = subscriber[0];

  let kind: PhoneKind;
  let subscriberFull = subscriber;
  if (subscriber.length === 9) {
    // Celular precisa começar com 9. "912345678" ok; "812345678" não existe.
    if (first !== "9") return null;
    kind = "mobile";
  } else if (first && first >= "6" && first <= "9") {
    // 8 dígitos começando 6-9 só existe como celular sem o nono dígito —
    // fixo nunca começa nessa faixa (sempre 2-5), então reconstruir é
    // seguro: é exatamente o motivo mais comum de "telefone inválido" na
    // extração (a prefeitura manda a lista sem o 9, formato antigo).
    kind = "mobile";
    subscriberFull = `9${subscriber}`;
  } else if (first && first >= "2" && first <= "5") {
    kind = "landline";
  } else {
    return null;
  }

  return { e164: `${BR_COUNTRY_CODE}${digits.slice(0, 2)}${subscriberFull}`, areaCode, kind };
}

/** Só celulares recebem WhatsApp. */
export function isWhatsappCapable(phone: NormalizedPhone | null): boolean {
  return phone?.kind === "mobile";
}

/**
 * Normaliza a lista de telefones de um paciente, remove duplicados e ordena
 * pelo melhor candidato a WhatsApp: celular antes de fixo, preservando a
 * ordem original dentro de cada grupo (a lista costuma trazer o número
 * principal primeiro).
 */
export function normalizePhoneList(raws: (string | null | undefined)[]): NormalizedPhone[] {
  const seen = new Set<string>();
  const normalized: NormalizedPhone[] = [];

  for (const raw of raws) {
    const phone = normalizePhone(raw);
    if (!phone || seen.has(phone.e164)) continue;
    seen.add(phone.e164);
    normalized.push(phone);
  }

  return [
    ...normalized.filter((p) => p.kind === "mobile"),
    ...normalized.filter((p) => p.kind === "landline"),
  ];
}

/**
 * Melhor número para o disparo, ou null quando o paciente não tem celular
 * — nesse caso o agendamento nasce com status SEM_TELEFONE e entra no
 * relatório como "não contatável", responsabilidade da secretaria.
 */
export function pickDispatchPhone(raws: (string | null | undefined)[]): string | null {
  const first = normalizePhoneList(raws).find((p) => p.kind === "mobile");
  return first?.e164 ?? null;
}

/**
 * Outro celular do cadastro do paciente, diferente do que já foi tentado —
 * sugestão pronta pra reenviar quando o primeiro falhou (Cancelamento e
 * Revisão/Acompanhamento reaproveitam, ver "Reenviar pra quem falhou").
 */
export function pickAlternatePhone(patientPhones: string[], triedPhone: string | null): string | null {
  const alternative = normalizePhoneList(patientPhones).find(
    (p) => p.kind === "mobile" && p.e164 !== triedPhone
  );
  return alternative?.e164 ?? null;
}

/**
 * A Meta às vezes manda o campo "from" do webhook sem o 9º dígito do
 * celular brasileiro (ex: 554797760610 em vez de 5547997760610) — bug
 * conhecido, documentado só em fóruns de desenvolvedor, não na doc oficial.
 * Como resposta de WhatsApp só vem de celular (nunca fixo), é seguro
 * reconstruir o candidato com o 9 de volta e tentar os dois formatos.
 *
 * Usado tanto pra achar o agendamento aguardando resposta (whatsapp.service)
 * quanto pra agrupar mensagens de um mesmo número na tela de conversas.
 */
export function phoneCandidates(from: string): string[] {
  const digits = from.replace(/\D/g, "");
  const candidates = [digits];
  // 55 + DDD (2) + assinante sem o 9 (8) = 12 dígitos.
  if (digits.length === 12 && digits.startsWith(BR_COUNTRY_CODE)) {
    candidates.push(`${BR_COUNTRY_CODE}${digits.slice(2, 4)}9${digits.slice(4)}`);
  }
  // E o caminho inverso: acha 12 dígitos a partir de 13 — achado em
  // 2026-08-26. `WhatsappMessage.phone` de uma mensagem RECEBIDA grava o
  // "from" cru da Meta (`whatsapp.service.ts`), sem passar por
  // `normalizePhone`; quando a Meta manda sem o 9º dígito, essa linha fica
  // salva com 12 dígitos. `getThread()` (tela de Conversas) busca a partir
  // do telefone já normalizado (13 dígitos, com o 9) — sem esse candidato
  // de volta pra 12, a mensagem recebida nunca batia no `WHERE phone IN
  // (...)` e sumia do chat (a lista da esquerda ainda mostrava certo, ela
  // agrupa por `normalizePhone` de cada mensagem, não por este helper).
  if (digits.length === 13 && digits.startsWith(BR_COUNTRY_CODE) && digits[4] === "9") {
    candidates.push(`${BR_COUNTRY_CODE}${digits.slice(2, 4)}${digits.slice(5)}`);
  }
  return candidates;
}

/** Formata pra exibição no painel: (47) 99894-3232 */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const national = digits.startsWith(BR_COUNTRY_CODE) ? digits.slice(2) : digits;
  if (national.length === 11) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return e164;
}
