-- Remove os campos de contato da secretaria (nome/telefone/e-mail) e o
-- envio automático de relatório por e-mail que dependia deles — decisão
-- explícita do usuário em 2026-08-15 de tirar isso de escopo de vez, não
-- só desativar.
ALTER TABLE "municipalities" DROP COLUMN "contactName";
ALTER TABLE "municipalities" DROP COLUMN "contactPhone";
ALTER TABLE "municipalities" DROP COLUMN "contactEmail";
