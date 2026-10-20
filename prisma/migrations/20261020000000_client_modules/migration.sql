-- Módulos por cliente: fluxo de mensagem, nome do remetente, lembrete/cancelamento ligáveis.
CREATE TYPE "MessageFlow" AS ENUM ('CONFIRMACAO', 'OFERTA');

ALTER TABLE "app_settings"
  ADD COLUMN "messageFlow" "MessageFlow" NOT NULL DEFAULT 'CONFIRMACAO',
  ADD COLUMN "senderName" TEXT,
  ADD COLUMN "moduleLembrete" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "moduleCancelamento" BOOLEAN NOT NULL DEFAULT true;
