CREATE TABLE "PerformerImagePreference" (
    "id" TEXT NOT NULL,
    "performerId" TEXT NOT NULL,
    "mainImageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformerImagePreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformerImagePreference_performerId_key" ON "PerformerImagePreference"("performerId");
