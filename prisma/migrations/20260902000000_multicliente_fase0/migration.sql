-- Fase 0 do plano multi-cliente (PLANO-MULTICLIENTE.md).
--
-- Migration ADITIVA: nenhuma linha de dado se move ou se perde. Cria os
-- clientes, cria UM cliente "DGS", dá a ele tudo que já existe, e só então
-- torna a coluna obrigatória. Ao fim desta migration o sistema se comporta
-- EXATAMENTE como hoje (só o cliente "DGS" existe, todo usuário já tem
-- acesso a ele) — isolamento de verdade só entra na Fase 1 (backend) e
-- Fase 3 (seletor de cliente na interface).
--
-- Sequência (ver PLANO-MULTICLIENTE.md seção 5):
--   1. Tabelas clients / user_clients + User.isSuperAdmin
--   2. Cliente "DGS"
--   3. clientId NULLABLE em cada tabela isolada
--   4. Popular tudo com o id do cliente "DGS"
--   5. clientId NOT NULL + índices
--   6. Unicidades compostas (Municipality, Procedure, Patient)
--   7. Acesso de todo usuário existente ao cliente "DGS"
--
-- NÃO faz sozinha: marcar alguém como isSuperAdmin (fica `false` por
-- padrão pra todo mundo) — é uma escalada de privilégio, feita à parte,
-- com confirmação explícita de quem deve receber, não em massa aqui.

-- =========================================================================
-- 1. Tabelas novas + User.isSuperAdmin
-- =========================================================================

CREATE TABLE "clients" (
    "id"        SERIAL PRIMARY KEY,
    "name"      TEXT NOT NULL,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "notes"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "clients_name_key" ON "clients"("name");

CREATE TABLE "user_clients" (
    "id"        SERIAL PRIMARY KEY,
    "userId"    INTEGER NOT NULL,
    "clientId"  INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_clients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_clients_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_clients_userId_clientId_key" ON "user_clients"("userId", "clientId");
CREATE INDEX "user_clients_clientId_idx" ON "user_clients"("clientId");

ALTER TABLE "users" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- =========================================================================
-- 2. Cliente "DGS" — recipiente de tudo que já existe
-- =========================================================================

INSERT INTO "clients" ("name", "active", "updatedAt")
VALUES ('DGS', true, CURRENT_TIMESTAMP);

-- =========================================================================
-- 3-5. clientId em cada tabela isolada: nullable -> popular -> NOT NULL + índice
--
-- As três primeiras (municipalities, health_units, doctors) e o
-- User.isSuperAdmin já foram cobertas junto do resto do bloco 1 acima na
-- ordem lógica do plano — aqui seguem as 14 tabelas restantes do WIP.
-- =========================================================================

DO $$
DECLARE
  dgs_id INTEGER := (SELECT id FROM "clients" WHERE "name" = 'DGS');
BEGIN
  -- municipalities
  ALTER TABLE "municipalities" ADD COLUMN "clientId" INTEGER;
  UPDATE "municipalities" SET "clientId" = dgs_id;
  ALTER TABLE "municipalities" ALTER COLUMN "clientId" SET NOT NULL;

  -- health_units
  ALTER TABLE "health_units" ADD COLUMN "clientId" INTEGER;
  UPDATE "health_units" SET "clientId" = dgs_id;
  ALTER TABLE "health_units" ALTER COLUMN "clientId" SET NOT NULL;

  -- doctors
  ALTER TABLE "doctors" ADD COLUMN "clientId" INTEGER;
  UPDATE "doctors" SET "clientId" = dgs_id;
  ALTER TABLE "doctors" ALTER COLUMN "clientId" SET NOT NULL;

  -- procedures
  ALTER TABLE "procedures" ADD COLUMN "clientId" INTEGER;
  UPDATE "procedures" SET "clientId" = dgs_id;
  ALTER TABLE "procedures" ALTER COLUMN "clientId" SET NOT NULL;

  -- doctor_procedures
  ALTER TABLE "doctor_procedures" ADD COLUMN "clientId" INTEGER;
  UPDATE "doctor_procedures" SET "clientId" = dgs_id;
  ALTER TABLE "doctor_procedures" ALTER COLUMN "clientId" SET NOT NULL;

  -- agendas
  ALTER TABLE "agendas" ADD COLUMN "clientId" INTEGER;
  UPDATE "agendas" SET "clientId" = dgs_id;
  ALTER TABLE "agendas" ALTER COLUMN "clientId" SET NOT NULL;

  -- lists
  ALTER TABLE "lists" ADD COLUMN "clientId" INTEGER;
  UPDATE "lists" SET "clientId" = dgs_id;
  ALTER TABLE "lists" ALTER COLUMN "clientId" SET NOT NULL;

  -- patients
  ALTER TABLE "patients" ADD COLUMN "clientId" INTEGER;
  UPDATE "patients" SET "clientId" = dgs_id;
  ALTER TABLE "patients" ALTER COLUMN "clientId" SET NOT NULL;

  -- appointments
  ALTER TABLE "appointments" ADD COLUMN "clientId" INTEGER;
  UPDATE "appointments" SET "clientId" = dgs_id;
  ALTER TABLE "appointments" ALTER COLUMN "clientId" SET NOT NULL;

  -- cancellation_batches
  ALTER TABLE "cancellation_batches" ADD COLUMN "clientId" INTEGER;
  UPDATE "cancellation_batches" SET "clientId" = dgs_id;
  ALTER TABLE "cancellation_batches" ALTER COLUMN "clientId" SET NOT NULL;

  -- message_jobs
  ALTER TABLE "message_jobs" ADD COLUMN "clientId" INTEGER;
  UPDATE "message_jobs" SET "clientId" = dgs_id;
  ALTER TABLE "message_jobs" ALTER COLUMN "clientId" SET NOT NULL;

  -- whatsapp_messages
  ALTER TABLE "whatsapp_messages" ADD COLUMN "clientId" INTEGER;
  UPDATE "whatsapp_messages" SET "clientId" = dgs_id;
  ALTER TABLE "whatsapp_messages" ALTER COLUMN "clientId" SET NOT NULL;

  -- whatsapp_accounts
  ALTER TABLE "whatsapp_accounts" ADD COLUMN "clientId" INTEGER;
  UPDATE "whatsapp_accounts" SET "clientId" = dgs_id;
  ALTER TABLE "whatsapp_accounts" ALTER COLUMN "clientId" SET NOT NULL;

  -- daily_closings
  ALTER TABLE "daily_closings" ADD COLUMN "clientId" INTEGER;
  UPDATE "daily_closings" SET "clientId" = dgs_id;
  ALTER TABLE "daily_closings" ALTER COLUMN "clientId" SET NOT NULL;

  -- closing_attachments
  ALTER TABLE "closing_attachments" ADD COLUMN "clientId" INTEGER;
  UPDATE "closing_attachments" SET "clientId" = dgs_id;
  ALTER TABLE "closing_attachments" ALTER COLUMN "clientId" SET NOT NULL;

  -- audit_logs
  ALTER TABLE "audit_logs" ADD COLUMN "clientId" INTEGER;
  UPDATE "audit_logs" SET "clientId" = dgs_id;
  ALTER TABLE "audit_logs" ALTER COLUMN "clientId" SET NOT NULL;

  -- Todo usuário que já existe ganha acesso ao cliente "DGS" — o sistema
  -- continua se comportando exatamente como hoje (perfil único, sem
  -- restrição), até a Fase 3 introduzir o seletor de cliente.
  INSERT INTO "user_clients" ("userId", "clientId")
  SELECT "id", dgs_id FROM "users";
END $$;

-- Índices em clientId (fora do bloco DO, precisa ser depois das colunas existirem)
CREATE INDEX "municipalities_clientId_idx" ON "municipalities"("clientId");
CREATE INDEX "health_units_clientId_idx" ON "health_units"("clientId");
CREATE INDEX "doctors_clientId_idx" ON "doctors"("clientId");
CREATE INDEX "procedures_clientId_idx" ON "procedures"("clientId");
CREATE INDEX "doctor_procedures_clientId_idx" ON "doctor_procedures"("clientId");
CREATE INDEX "agendas_clientId_idx" ON "agendas"("clientId");
CREATE INDEX "lists_clientId_idx" ON "lists"("clientId");
CREATE INDEX "patients_clientId_idx" ON "patients"("clientId");
CREATE INDEX "appointments_clientId_idx" ON "appointments"("clientId");
CREATE INDEX "cancellation_batches_clientId_idx" ON "cancellation_batches"("clientId");
CREATE INDEX "message_jobs_clientId_status_scheduledFor_idx" ON "message_jobs"("clientId", "status", "scheduledFor");
CREATE INDEX "whatsapp_messages_clientId_phone_idx" ON "whatsapp_messages"("clientId", "phone");
CREATE INDEX "whatsapp_accounts_clientId_idx" ON "whatsapp_accounts"("clientId");
CREATE INDEX "daily_closings_clientId_idx" ON "daily_closings"("clientId");
CREATE INDEX "closing_attachments_clientId_idx" ON "closing_attachments"("clientId");
CREATE INDEX "audit_logs_clientId_idx" ON "audit_logs"("clientId");

-- Foreign keys pro cliente, em cada uma das 14 tabelas do bloco acima.
ALTER TABLE "municipalities"        ADD CONSTRAINT "municipalities_clientId_fkey"        FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "health_units"          ADD CONSTRAINT "health_units_clientId_fkey"          FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctors"               ADD CONSTRAINT "doctors_clientId_fkey"               FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "procedures"            ADD CONSTRAINT "procedures_clientId_fkey"            FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_procedures"     ADD CONSTRAINT "doctor_procedures_clientId_fkey"     FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agendas"               ADD CONSTRAINT "agendas_clientId_fkey"               FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lists"                 ADD CONSTRAINT "lists_clientId_fkey"                 FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patients"              ADD CONSTRAINT "patients_clientId_fkey"              FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments"          ADD CONSTRAINT "appointments_clientId_fkey"          FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cancellation_batches"  ADD CONSTRAINT "cancellation_batches_clientId_fkey"  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_jobs"          ADD CONSTRAINT "message_jobs_clientId_fkey"          FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages"     ADD CONSTRAINT "whatsapp_messages_clientId_fkey"     FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "whatsapp_accounts"     ADD CONSTRAINT "whatsapp_accounts_clientId_fkey"     FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_closings"        ADD CONSTRAINT "daily_closings_clientId_fkey"        FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "closing_attachments"   ADD CONSTRAINT "closing_attachments_clientId_fkey"   FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs"            ADD CONSTRAINT "audit_logs_clientId_fkey"            FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =========================================================================
-- 6. Unicidades: globais -> compostas por cliente (achado 3.1 do plano)
-- =========================================================================

DROP INDEX "municipalities_name_state_key";
CREATE UNIQUE INDEX "municipalities_clientId_name_state_key" ON "municipalities"("clientId", "name", "state");

DROP INDEX "procedures_name_key";
CREATE UNIQUE INDEX "procedures_clientId_name_key" ON "procedures"("clientId", "name");

DROP INDEX "patients_cns_key";
CREATE UNIQUE INDEX "patients_clientId_cns_key" ON "patients"("clientId", "cns");

-- whatsapp_accounts.phoneNumberId único: é o que o webhook vai usar pra
-- resolver clientId a partir de metadata.phone_number_id (achado 3.2 do
-- plano) — sem isso, uma resposta de paciente poderia ser processada
-- contra o cliente errado. Só há uma linha ativa hoje, então não colide.
CREATE UNIQUE INDEX "whatsapp_accounts_phoneNumberId_key" ON "whatsapp_accounts"("phoneNumberId");

-- =========================================================================
-- 7. app_settings: linha única global -> uma linha por cliente
-- =========================================================================

-- A tabela nasceu com id fixo em 1 (sem sequence) e uma única linha. Agora
-- vira "uma linha por cliente": precisa de uma sequence de verdade pro
-- autoincrement funcionar quando um segundo cliente for criado.
CREATE SEQUENCE "app_settings_id_seq" OWNED BY "app_settings"."id";
SELECT setval('"app_settings_id_seq"', (SELECT COALESCE(MAX("id"), 1) FROM "app_settings"));
ALTER TABLE "app_settings" ALTER COLUMN "id" SET DEFAULT nextval('"app_settings_id_seq"');

ALTER TABLE "app_settings" ADD COLUMN "clientId" INTEGER;
UPDATE "app_settings" SET "clientId" = (SELECT id FROM "clients" WHERE "name" = 'DGS');
ALTER TABLE "app_settings" ALTER COLUMN "clientId" SET NOT NULL;
CREATE UNIQUE INDEX "app_settings_clientId_key" ON "app_settings"("clientId");
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
