-- Tokens de acesso só de leitura pra integração externa (GPT do ChatGPT).
-- Aditivo: tabela nova, nada existente muda.
CREATE TABLE "api_tokens" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");
CREATE INDEX "api_tokens_clientId_idx" ON "api_tokens"("clientId");

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
