ALTER TABLE "AppSettings"
  ADD COLUMN "defaultRootFolderPath" TEXT,
  ADD COLUMN "defaultQualityProfileId" INTEGER,
  ADD COLUMN "defaultMonitored" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "defaultSearchForMovie" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "defaultTagIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
