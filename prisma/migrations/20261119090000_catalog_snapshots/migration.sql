-- CreateTable
CREATE TABLE "CatalogSnapshot" (
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "data" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogSnapshot_pkey" PRIMARY KEY ("provider","kind","catalogId")
);

-- CreateIndex
CREATE INDEX "CatalogSnapshot_kind_fetchedAt_idx" ON "CatalogSnapshot"("kind", "fetchedAt");
