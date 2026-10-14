CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "singletonKey" INTEGER NOT NULL DEFAULT 1,
    "hideAmateurNetworkResults" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppSettings_singletonKey_key" ON "AppSettings"("singletonKey");
