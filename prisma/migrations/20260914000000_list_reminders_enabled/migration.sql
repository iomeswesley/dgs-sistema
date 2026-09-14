-- Lembrete D-1 deixa de ser automático pra toda lista — vem desligado por
-- padrão (aditiva, `DEFAULT false`, não muda nenhuma lista já disparada) e
-- passa a exigir ativação explícita por lista (com confirmação no
-- frontend). Ver `enqueueReminders()` em cadence.service.ts.
ALTER TABLE "lists" ADD COLUMN "remindersEnabled" BOOLEAN NOT NULL DEFAULT false;
