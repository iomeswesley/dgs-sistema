-- Limite comercial de mensagens por cliente. Aditivo — todas as colunas
-- nullable, cliente existente ("DGS") continua sem limite (billingMode null).
CREATE TYPE "BillingMode" AS ENUM ('JANELA', 'CREDITOS');

ALTER TABLE "app_settings"
  ADD COLUMN "billingMode" "BillingMode",
  ADD COLUMN "messageLimit" INTEGER,
  ADD COLUMN "periodStartDate" DATE,
  ADD COLUMN "periodLengthDays" INTEGER,
  ADD COLUMN "creditsBalance" INTEGER,
  ADD COLUMN "creditsGrantedAt" TIMESTAMP(3);
