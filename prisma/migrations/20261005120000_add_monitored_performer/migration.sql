CREATE TABLE "MonitoredPerformer" (
    "id" TEXT NOT NULL,
    "performerId" TEXT NOT NULL,
    "monitoredSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    "handledSceneIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoredPerformer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoredPerformer_performerId_key" ON "MonitoredPerformer"("performerId");
