import { describe, expect, it } from "vitest";
import { parseInboundReplies } from "@/lib/whatsapp-webhook.js";

/*
  Mensagem do paciente que não é texto nem clique de botão (imagem, áudio,
  figurinha, localização, contato, reação…) precisa virar uma descrição
  legível em `contentDescription` — antes disso `text` e `buttonPayload`
  ficavam os dois `null` e a tela mostrava só "—", sem indicar o que o
  paciente mandou de verdade (achado pelo usuário em 2026-08-27).
*/

function webhookPayload(message: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.test",
                  from: "5547998943232",
                  timestamp: "1735300000",
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Roda o parser e devolve a única resposta esperada, já validando a contagem. */
function parseOne(message: Record<string, unknown>) {
  const replies = parseInboundReplies(webhookPayload(message));
  expect(replies).toHaveLength(1);
  return replies[0]!;
}

describe("parseInboundReplies", () => {
  it("mensagem de texto normal: contentDescription fica null (já coberto por `text`)", () => {
    const reply = parseOne({ type: "text", text: { body: "Oi, tudo bem?" } });
    expect(reply.text).toBe("Oi, tudo bem?");
    expect(reply.contentDescription).toBeNull();
  });

  it("clique de botão: contentDescription fica null (já coberto por `buttonPayload`)", () => {
    const reply = parseOne({ type: "button", button: { payload: "SIM", text: "Sim" } });
    expect(reply.buttonPayload).toBe("SIM");
    expect(reply.contentDescription).toBeNull();
  });

  it("imagem com legenda", () => {
    const reply = parseOne({ type: "image", image: { caption: "minha receita" } });
    expect(reply.text).toBeNull();
    expect(reply.contentDescription).toBe("📷 Imagem: minha receita");
  });

  it("imagem sem legenda", () => {
    const reply = parseOne({ type: "image", image: {} });
    expect(reply.contentDescription).toBe("📷 Imagem");
  });

  it("áudio: distingue mensagem de voz de áudio comum", () => {
    const voice = parseOne({ type: "audio", audio: { voice: true } });
    expect(voice.contentDescription).toBe("🎤 Mensagem de voz");

    const audio = parseOne({ type: "audio", audio: { voice: false } });
    expect(audio.contentDescription).toBe("🎵 Áudio");
  });

  it("documento com nome de arquivo", () => {
    const reply = parseOne({ type: "document", document: { filename: "exame.pdf" } });
    expect(reply.contentDescription).toBe("📄 Documento: exame.pdf");
  });

  it("figurinha, localização, contato e reação", () => {
    const sticker = parseOne({ type: "sticker" });
    expect(sticker.contentDescription).toBe("🙂 Figurinha");

    const location = parseOne({ type: "location", location: { name: "Casa" } });
    expect(location.contentDescription).toBe("📍 Localização: Casa");

    const contact = parseOne({ type: "contacts", contacts: [{ name: { formatted_name: "Maria" } }] });
    expect(contact.contentDescription).toBe("👤 Contato compartilhado: Maria");

    const reaction = parseOne({ type: "reaction", reaction: { emoji: "👍" } });
    expect(reaction.contentDescription).toBe("Reagiu com 👍");
  });

  it("tipo desconhecido ainda vira algo visível, nunca some em silêncio", () => {
    const reply = parseOne({ type: "unknown_future_type" });
    expect(reply.contentDescription).toBe("[tipo de mensagem não suportado]");
  });

  it("imagem/áudio/documento carregam o id de mídia pra baixar depois", () => {
    const image = parseOne({ type: "image", image: { id: "media-1", mime_type: "image/jpeg" } });
    expect(image.mediaId).toBe("media-1");
    expect(image.mediaMimeType).toBe("image/jpeg");
    expect(image.mediaFilename).toBeNull();

    const document = parseOne({
      type: "document",
      document: { id: "media-2", mime_type: "application/pdf", filename: "exame.pdf" },
    });
    expect(document.mediaId).toBe("media-2");
    expect(document.mediaFilename).toBe("exame.pdf");
  });

  it("texto, botão, localização, contato e reação não têm mídia pra baixar", () => {
    const text = parseOne({ type: "text", text: { body: "oi" } });
    expect(text.mediaId).toBeNull();

    const location = parseOne({ type: "location", location: { name: "Casa" } });
    expect(location.mediaId).toBeNull();
  });
});
