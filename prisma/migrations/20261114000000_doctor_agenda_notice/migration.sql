-- Aviso da agenda ao médico na véspera (2026-11-14). Aditivo: colunas novas
-- nullable/com default e um valor novo de enum (sem DML usando o valor na
-- mesma transação).
ALTER TYPE "TemplateKind" ADD VALUE 'AVISO_MEDICO';

ALTER TABLE "doctors" ADD COLUMN "phone" TEXT;
ALTER TABLE "doctors" ADD COLUMN "title" TEXT;
ALTER TABLE "doctors" ADD COLUMN "notifyAgenda" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "agendas" ADD COLUMN "doctorNoticeSentAt" TIMESTAMP(3);
ALTER TABLE "agendas" ADD COLUMN "doctorNoticeFailedAt" TIMESTAMP(3);
ALTER TABLE "agendas" ADD COLUMN "doctorNoticeError" TEXT;
