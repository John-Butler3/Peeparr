export type LibrarySceneSort =
  | 'CREATED_AT'
  | 'UPDATED_AT'
  | 'TITLE'
  | 'RELEASE_DATE';

export type LibrarySortDirection = 'ASC' | 'DESC';
export type LibraryTagMatchMode = 'OR' | 'AND';

export interface LibraryTagOption {
  id: string;
  name: string;
}

export interface LibraryStudioOption {
  id: string;
  name: string;
}

export interface LibrarySceneItem {
  id: string;
  activeCatalogSceneId: string | null;
  title: string;
  description: string | null;
  imageUrl: string | null;
  cardImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  performerNames: string[];
  releaseDate: string | null;
  duration: number | null;
  localCreatedAt: string | null;
  type: 'SCENE';
  source: 'STASH';
  viewUrl: string;
}

export interface LibraryScenesFeedResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  latestSyncAt: string | null;
  items: LibrarySceneItem[];
}

export interface LibrarySearchScenes {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: LibrarySceneItem[];
}

// Ids are Stash-local, matching the library feed's performer/studio/tag filters.
export interface LibrarySearchPerformer {
  id: string;
  name: string;
  imageUrl: string;
  sceneCount: number;
}

export interface LibrarySearchStudio {
  id: string;
  name: string;
  imageUrl: string | null;
  sceneCount: number;
}

export interface LibrarySearchTag {
  id: string;
  name: string;
  sceneCount: number;
}

export interface LibrarySearchResponse {
  query: string;
  scenes: LibrarySearchScenes;
  performers: LibrarySearchPerformer[];
  studios: LibrarySearchStudio[];
  tags: LibrarySearchTag[];
}

export interface LibrarySceneDetail extends LibrarySceneItem {
  /** Stash-local studio id (for the library studio filter). */
  libraryStudioId: string | null;
  performers: Array<{ id: string; name: string; imageUrl: string }>;
  tags: Array<{ id: string; name: string }>;
}
