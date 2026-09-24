-- Contatos do formulário da landing page pública (RegulAção). Aditivo.
CREATE TABLE "contact_leads" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "contact_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_leads_createdAt_idx" ON "contact_leads"("createdAt");
