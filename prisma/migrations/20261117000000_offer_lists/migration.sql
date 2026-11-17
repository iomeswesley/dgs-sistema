-- Listas de oferta (2026-11-17, cliente Botuverá). Aditivo: coluna com
-- default e valores novos de enum (sem DML usando os valores na mesma
-- transação).
ALTER TYPE "TemplateKind" ADD VALUE 'OFERTA';
ALTER TYPE "MessageFlow" ADD VALUE 'AMBOS';

ALTER TABLE "lists" ADD COLUMN "isOffer" BOOLEAN NOT NULL DEFAULT false;
