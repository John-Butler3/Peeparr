-- Library search matches scenes by performer name via the same flattened
-- text[] expression as the tag search; index it the same way so the
-- substring match doesn't scan every scene row.
CREATE INDEX "LibrarySceneIndex_performerNames_trgm_idx"
ON "LibrarySceneIndex"
USING GIN ((library_scene_tag_names_search_text("performerNames")) gin_trgm_ops);
