-- Formato novo de extração — "TABULAR": exportação de uma linha por
-- paciente (código, nome, nascimento, telefone, procedimento, data,
-- horário), sem o cabeçalho de agenda nem a fragmentação multi-linha do
-- SISREG de verdade. Achado pela primeira vez em 2026-09-16 (lista de
-- Botuverá). Aditivo — ALTER TYPE ADD VALUE não pode rodar na mesma
-- transação que referencia o valor novo, mas como não há DML aqui usando
-- 'TABULAR', é seguro rodar direto.
ALTER TYPE "SourceFormat" ADD VALUE 'TABULAR';
