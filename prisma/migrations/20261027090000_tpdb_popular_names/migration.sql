-- The names the TPDB homepage shows for its popular performers and sites,
-- so each is matched to the right API record.
ALTER TABLE "TpdbWebAccount" ADD COLUMN "popularPerformerNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TpdbWebAccount" ADD COLUMN "popularSiteNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
