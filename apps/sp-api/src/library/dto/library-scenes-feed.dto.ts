export class LibrarySceneFeedItemDto {
  id!: string;
  activeCatalogSceneId!: string | null;
  title!: string;
  description!: string | null;
  imageUrl!: string | null;
  cardImageUrl!: string | null;
  studioId!: string | null;
  studio!: string | null;
  studioImageUrl!: string | null;
  performerNames!: string[];
  releaseDate!: string | null;
  duration!: number | null;
  localCreatedAt!: Date | null;
  type!: 'SCENE';
  source!: 'STASH';
  viewUrl!: string;
}

export class LibraryScenesFeedDto {
  total!: number;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  latestSyncAt!: Date | null;
  items!: LibrarySceneFeedItemDto[];
}

export class LibrarySceneDetailDto extends LibrarySceneFeedItemDto {
  /** Stash-local studio id, usable as a library studioIds filter. */
  libraryStudioId!: string | null;
  performers!: Array<{ id: string; name: string; imageUrl: string }>;
  tags!: Array<{ id: string; name: string }>;
}
