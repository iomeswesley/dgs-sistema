-- Mídia recebida do paciente (imagem, áudio, figurinha, documento) passa a
-- ser baixada da Meta e guardada em WhatsappMessage, com retenção
-- configurável em AppSettings (linha única, id sempre 1).

ALTER TABLE "whatsapp_messages" ADD COLUMN "mediaData" BYTEA;
ALTER TABLE "whatsapp_messages" ADD COLUMN "mediaMimeType" TEXT;
ALTER TABLE "whatsapp_messages" ADD COLUMN "mediaFilename" TEXT;

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mediaRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "app_settings" ("id", "mediaRetentionDays", "updatedAt") VALUES (1, 7, CURRENT_TIMESTAMP);
