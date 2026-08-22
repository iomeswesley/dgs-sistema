-- Cancelamento pela DGS (médico indisponível pra agenda inteira) —
-- feature nova, decisão do usuário em 2026-08-22. Aditivo: nenhuma coluna
-- ou tabela existente é alterada/removida, só cresce.

-- Novo status terminal de Appointment, diferente de RECUSADO (que é o
-- paciente dizendo que não vai). ALTER TYPE ADD VALUE não pode ser usado
-- na mesma transação que referencia o valor novo — como não há DML aqui
-- usando 'CANCELADO'/'CANCELAMENTO', é seguro rodar direto.
ALTER TYPE "AppointmentStatus" ADD VALUE 'CANCELADO';

-- Novo template — cada "disparo" de cancelamento usa ele.
ALTER TYPE "TemplateKind" ADD VALUE 'CANCELAMENTO';

-- CreateTable
CREATE TABLE "cancellation_batches" (
    "id" SERIAL NOT NULL,
    "agendaId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cancellation_batches_agendaId_idx" ON "cancellation_batches"("agendaId");

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "cancellationBatchId" INTEGER,
ADD COLUMN "canceledById" INTEGER,
ADD COLUMN "canceledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "appointments_cancellationBatchId_idx" ON "appointments"("cancellationBatchId");

-- AddForeignKey
ALTER TABLE "cancellation_batches" ADD CONSTRAINT "cancellation_batches_agendaId_fkey" FOREIGN KEY ("agendaId") REFERENCES "agendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_batches" ADD CONSTRAINT "cancellation_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_canceledById_fkey" FOREIGN KEY ("canceledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancellationBatchId_fkey" FOREIGN KEY ("cancellationBatchId") REFERENCES "cancellation_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
