-- Popular performers from the TPDB website, like its popular scenes.
ALTER TABLE "TpdbWebAccount" ADD COLUMN "popularPerformerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TpdbWebAccount" ADD COLUMN "popularPerformerSourcePath" TEXT;
