-- Novo template — "Reagendar" em Revisão (2026-09-08): corrigir a
-- data/hora de um agendamento já disparado e reabrir a confirmação pro
-- horário certo, sem precisar subir a lista de novo. ALTER TYPE ADD VALUE
-- não pode ser usado na mesma transação que referencia o valor novo — como
-- não há DML aqui usando 'REAGENDAMENTO', é seguro rodar direto.
ALTER TYPE "TemplateKind" ADD VALUE 'REAGENDAMENTO';
