-- Tolerância do limite comercial de mensagens (2026-11-23). Aditivo, nullable.
ALTER TABLE "app_settings" ADD COLUMN "billingTolerance" INTEGER;
