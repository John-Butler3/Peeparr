import { PlayerDetails } from './player.service';
import { UpNextItem } from '../../shared/up-next-list/up-next-list.component';
import { SeriesDetail } from '../api/groups.types';

// Watch-panel details for a scene from the local library (library grid,
// library search, series parts, the local scene page).
export function libraryScenePlayerDetails(item: {
  id: string;
  activeCatalogSceneId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  releaseDate: string | null;
  performerNames: readonly string[];
  description: string | null;
  viewUrl: string;
}): PlayerDetails {
  return {
    studio: item.studio,
    studioImageUrl: item.studioImageUrl,
    releaseDate: item.releaseDate,
    performers: item.performerNames,
    description: item.description,
    detailsLink: item.activeCatalogSceneId
      ? { commands: ['/scene', item.activeCatalogSceneId] }
      : { commands: ['/library/scene', item.id] },
    stashUrl: item.viewUrl,
  };
}

// Up-next row for a library scene: its catalog page when it has one,
// otherwise the library scene page.
export function libraryUpNextItem(item: {
  id: string;
  activeCatalogSceneId: string | null;
  title: string;
  cardImageUrl: string | null;
  imageUrl: string | null;
  studio: string | null;
  studioImageUrl?: string | null;
  releaseDate: string | null;
  duration: number | null;
}): UpNextItem {
  return {
    id: item.id,
    title: item.title,
    imageUrl: item.cardImageUrl ?? item.imageUrl,
    studio: item.studio,
    studioImageUrl: item.studioImageUrl ?? null,
    previewKind: 'local',
    releaseDate: item.releaseDate,
    duration: item.duration,
    commands: item.activeCatalogSceneId
      ? ['/scene', item.activeCatalogSceneId]
      : ['/library/scene', item.id],
  };
}

// Up next for a scene in a series: the parts after it, in series order.
export function seriesUpNextItems(series: SeriesDetail, currentSceneId: string): UpNextItem[] {
  const position = series.scenes.findIndex((scene) => scene.id === currentSceneId);
  if (position < 0) {
    return [];
  }

  return series.scenes.slice(position + 1).map((scene) => ({
    ...libraryUpNextItem(scene),
    label: scene.sceneIndex !== null ? `Part ${scene.sceneIndex} · ${series.name}` : series.name,
  }));
}

// Series parts first (so autoplay continues the series), then the rest
// without repeats.
export function mergeUpNext(
  first: readonly UpNextItem[],
  rest: readonly UpNextItem[],
): UpNextItem[] {
  const seen = new Set(first.map((item) => item.id));
  return [...first, ...rest.filter((item) => !seen.has(item.id))];
}
