-- Formato novo de extração — "EXCEL": planilha no modelo oficial da
-- plataforma (modelo-importacao-dgs.xlsx), pra clientes converterem o Excel
-- que a secretaria manda num layout padrão. Aditivo — sem DML usando o valor
-- novo na mesma transação, seguro rodar direto.
ALTER TYPE "SourceFormat" ADD VALUE 'EXCEL';
