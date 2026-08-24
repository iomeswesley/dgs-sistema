-- Cancelamento passa a aceitar duas origens: Agenda já cadastrada (como
-- antes) OU uma List enviada na hora, sem agenda nenhuma vinculada — pro
-- caso "nunca passou pela plataforma". agendaId vira opcional; listId é
-- novo. Exatamente um dos dois é preenchido, validado na aplicação.

ALTER TABLE "cancellation_batches" ALTER COLUMN "agendaId" DROP NOT NULL;

ALTER TABLE "cancellation_batches" ADD COLUMN "listId" INTEGER;

-- CreateIndex
CREATE INDEX "cancellation_batches_listId_idx" ON "cancellation_batches"("listId");

-- AddForeignKey
ALTER TABLE "cancellation_batches" ADD CONSTRAINT "cancellation_batches_listId_fkey" FOREIGN KEY ("listId") REFERENCES "lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
