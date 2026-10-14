import { LibrarySceneItem } from './library.types';

// "Series" in the UI are Stash Groups: ordered collections of scenes.
export interface SeriesSummary {
  id: string;
  name: string;
  date: string | null;
  studio: string | null;
  sceneCount: number;
  coverImageUrl: string;
}

export interface SeriesFeedResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: SeriesSummary[];
}

export interface SeriesScene extends LibrarySceneItem {
  /** Part number within the series; null when Stash has none set. */
  sceneIndex: number | null;
}

export interface SeriesDetail extends SeriesSummary {
  synopsis: string | null;
  viewUrl: string;
  scenes: SeriesScene[];
}

export interface SceneSeriesMembership {
  id: string;
  name: string;
  sceneIndex: number | null;
}
