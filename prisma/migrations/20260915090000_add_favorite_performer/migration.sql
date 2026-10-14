CREATE TABLE "FavoritePerformer" (
    "id" TEXT NOT NULL,
    "performerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoritePerformer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FavoritePerformer_performerId_key" ON "FavoritePerformer"("performerId");
