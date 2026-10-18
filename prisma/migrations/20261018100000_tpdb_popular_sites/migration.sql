-- Popular sites from the TPDB website, like its popular scenes and performers.
ALTER TABLE "TpdbWebAccount" ADD COLUMN "popularSiteIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TpdbWebAccount" ADD COLUMN "popularSiteSourcePath" TEXT;
