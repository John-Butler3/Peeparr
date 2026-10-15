import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { RuntimeHealthServiceKey } from '@prisma/client';
import {
  type CatalogProviderKey,
  findCatalogExternalIdForProvider,
  hasCatalogSceneRef,
  normalizeCatalogSceneRefs,
} from '../catalog/catalog-provider.util';
import { RuntimeHealthService } from '../../runtime-health/runtime-health.service';
import { fetchWithTimeout } from '../fetch-with-timeout';

export interface StashAdapterBaseConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface StashSceneMatch {
  id: string;
  width: number | null;
  height: number | null;
  viewUrl: string;
  label: string;
  duration: number | null;
  resumeSeconds: number;
}

export const STASH_SCENE_FEED_SORT_VALUES = [
  'CREATED_AT',
  'UPDATED_AT',
  'TITLE',
] as const;
export type StashSceneFeedSort = (typeof STASH_SCENE_FEED_SORT_VALUES)[number];

export const STASH_SCENE_FEED_DIRECTION_VALUES = ['ASC', 'DESC'] as const;
export type StashSceneFeedDirection =
  (typeof STASH_SCENE_FEED_DIRECTION_VALUES)[number];
export const STASH_SCENE_FEED_TAG_MODE_VALUES = ['OR', 'AND'] as const;
export type StashSceneFeedTagMode =
  (typeof STASH_SCENE_FEED_TAG_MODE_VALUES)[number];

export interface StashLocalSceneFeedConfig {
  page: number;
  perPage: number;
  sort: StashSceneFeedSort;
  direction: StashSceneFeedDirection;
  titleQuery?: string | null;
  tagIds?: string[];
  tagMode?: StashSceneFeedTagMode | null;
  studioIds?: string[];
  favoritePerformersOnly?: boolean;
  favoriteStudiosOnly?: boolean;
  favoriteTagsOnly?: boolean;
}

export interface StashLocalSceneIdentityPageConfig {
  page: number;
  perPage: number;
}

export interface StashLocalLibraryScenePageConfig {
  page: number;
  perPage: number;
}

export interface StashLinkedSceneStashId {
  endpoint: string;
  stashId: string;
}

export interface StashLocalSceneIdentityItem {
  id: string;
  linkedStashIds: StashLinkedSceneStashId[];
}

export interface StashLocalSceneIdentityPage {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StashLocalSceneIdentityItem[];
}

export interface StashLocalLibrarySceneItem {
  id: string;
  activeCatalogSceneId: string | null;
  linkedCatalogRefs: string[];
  title: string;
  description: string | null;
  imageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  performerIds: string[];
  performerNames: string[];
  tagIds: string[];
  tagNames: string[];
  releaseDate: string | null;
  duration: number | null;
  viewUrl: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  hasFavoritePerformer: boolean;
  favoriteStudio: boolean;
  hasFavoriteTag: boolean;
}

export interface StashLocalLibraryScenePage {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StashLocalLibrarySceneItem[];
}

export interface StashLocalGalleryFeedConfig {
  page: number;
  perPage: number;
  titleQuery?: string | null;
  tagIds?: string[];
  studioIds?: string[];
  performerIds?: string[];
}

export interface StashLocalGalleryPerformer {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface StashLocalGalleryFeedItem {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  performers: StashLocalGalleryPerformer[];
  tagIds: string[];
  tagNames: string[];
  imageCount: number;
  releaseDate: string | null;
  viewUrl: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface StashLocalGalleryFeedPage {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StashLocalGalleryFeedItem[];
}

export interface StashLocalGalleryImage {
  id: string;
  title: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface StashLocalGalleryImagePage {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StashLocalGalleryImage[];
}

export interface StashLocalPerformerMatch {
  id: string;
  favorite: boolean;
}

export interface StashSceneMatchOverlayConfig {
  providerKey?: CatalogProviderKey | null;
  favoritePerformersOnly?: boolean;
  favoriteStudiosOnly?: boolean;
  favoriteTagsOnly?: boolean;
}

export interface StashLocalSceneFeedItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  cardImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  releaseDate: string | null;
  duration: number | null;
  viewUrl: string;
}

export interface StashLocalSceneFeed {
  total: number;
  items: StashLocalSceneFeedItem[];
}

export interface StashContinueWatchingItem {
  id: string;
  activeCatalogSceneId: string | null;
  title: string;
  description: string | null;
  imageUrl: string | null;
  cardImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  releaseDate: string | null;
  duration: number | null;
  viewUrl: string;
  resumeSeconds: number;
  progressPercent: number;
}

// How far through a scene the viewer is: a resume point, or 100 once played
// through. Keyed by Stash scene id, plus the active catalog's id if linked.
export interface StashWatchProgressItem {
  id: string;
  activeCatalogSceneId: string | null;
  progressPercent: number;
}

export interface StashLocalTagOption {
  id: string;
  name: string;
}

export interface StashLocalStudioOption {
  id: string;
  name: string;
  childStudios: Array<{
    id: string;
    name: string;
  }>;
}

export interface StashProtectedAssetResponse {
  body: Buffer;
  contentType: string | null;
  contentLength: string | null;
  cacheControl: string | null;
}

interface StashLocalSceneRecord {
  id?: unknown;
  title?: unknown;
  details?: unknown;
  date?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  stash_ids?: Array<{
    endpoint?: unknown;
    stash_id?: unknown;
  }> | null;
  paths?: {
    screenshot?: unknown;
  } | null;
  studio?: {
    id?: unknown;
    name?: unknown;
    image_path?: unknown;
    favorite?: unknown;
  } | null;
  performers?: Array<{
    id?: unknown;
    name?: unknown;
    favorite?: unknown;
  }> | null;
  tags?: Array<{
    id?: unknown;
    name?: unknown;
    favorite?: unknown;
  }> | null;
  files?: Array<{
    width?: unknown;
    height?: unknown;
    duration?: unknown;
  }>;
  resume_time?: unknown;
  play_count?: unknown;
}

interface StashSceneAssetRecord {
  id?: unknown;
  paths?: {
    screenshot?: unknown;
    stream?: unknown;
    preview?: unknown;
  } | null;
  resume_time?: unknown;
  files?: Array<{ duration?: unknown }>;
}

interface StashStudioAssetRecord {
  id?: unknown;
  image_path?: unknown;
}

interface StashPerformerAssetRecord {
  id?: unknown;
  image_path?: unknown;
}

interface StashTagRecord {
  id?: unknown;
  name?: unknown;
}

interface StashStudioSearchRecord {
  id?: unknown;
  name?: unknown;
  parent_studio?: {
    id?: unknown;
    name?: unknown;
  } | null;
  child_studios?: Array<{
    id?: unknown;
    name?: unknown;
  }> | null;
}

interface StashGalleryRecord {
  id?: unknown;
  title?: unknown;
  date?: unknown;
  details?: unknown;
  image_count?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  // Gallery.cover is an optional Image *relation* -- only present when
  // Stash has actually designated one, and often null even for galleries
  // with real photos. Gallery.paths.cover is a flat, dynamically-generated
  // URL that Stash always serves regardless of whether that relation is
  // set, so it's queried as a fallback (mirrors how Scene exposes
  // paths.screenshot directly rather than only through a relation).
  cover?: {
    paths?: {
      thumbnail?: unknown;
    } | null;
  } | null;
  paths?: {
    cover?: unknown;
  } | null;
  // Folder/file path used to derive a readable fallback title when Stash
  // has no title set (common for galleries that were just scanned from a
  // folder/zip and never manually named).
  folder?: {
    path?: unknown;
  } | null;
  files?: Array<{
    path?: unknown;
  }> | null;
  studio?: {
    id?: unknown;
    name?: unknown;
    image_path?: unknown;
  } | null;
  performers?: Array<{
    id?: unknown;
    name?: unknown;
    image_path?: unknown;
  }> | null;
  tags?: Array<{
    id?: unknown;
    name?: unknown;
  }> | null;
}

interface StashImageRecord {
  id?: unknown;
  title?: unknown;
  paths?: {
    thumbnail?: unknown;
    image?: unknown;
  } | null;
  files?: Array<{
    width?: unknown;
    height?: unknown;
  }> | null;
}

interface StashPerformerMatchRecord {
  id?: unknown;
  favorite?: unknown;
}

interface StashGraphqlResponse {
  data?: {
    findScenes?: {
      count?: unknown;
      scenes?: StashLocalSceneRecord[];
    };
    findScene?: StashSceneAssetRecord | null;
    findStudio?: StashStudioAssetRecord | null;
    findPerformer?: StashPerformerAssetRecord | null;
    findTags?: {
      tags?: StashTagRecord[];
    };
    findStudios?: {
      studios?: StashStudioSearchRecord[];
    };
    findGalleries?: {
      count?: unknown;
      galleries?: StashGalleryRecord[];
    };
    findGallery?: StashGalleryRecord | null;
    findImages?: {
      count?: unknown;
      images?: StashImageRecord[];
    };
    findImage?: StashImageRecord | null;
    findPerformers?: {
      performers?: StashPerformerMatchRecord[];
    };
  };
  errors?: Array<{ message?: unknown }>;
}

@Injectable()
export class StashAdapter {
  private readonly logger = new Logger(StashAdapter.name);

  constructor(private readonly runtimeHealthService: RuntimeHealthService) {}

  async testConnection(config: StashAdapterBaseConfig): Promise<void> {
    await this.checkConnection(config, false);
  }

  async probeConnection(config: StashAdapterBaseConfig): Promise<void> {
    await this.checkConnection(config, true);
  }

  private async checkConnection(
    config: StashAdapterBaseConfig,
    trackRuntimeHealth: boolean,
  ): Promise<void> {
    const query = `
      query ConnectivityCheck {
        __typename
      }
    `;

    await this.executeQuery(config, query, undefined, trackRuntimeHealth);
  }

  async findScenesByStashId(
    stashId: string,
    config: StashAdapterBaseConfig,
    overlays?: StashSceneMatchOverlayConfig,
  ): Promise<StashSceneMatch[]> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      return [];
    }

    const query = `
      query FindScenes($sceneFilter: SceneFilterType) {
        findScenes(scene_filter: $sceneFilter) {
          count
          scenes {
            id
            resume_time
            files {
              height
              width
              duration
            }
            stash_ids {
              endpoint
              stash_id
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      sceneFilter: this.buildSceneMatchFilter(normalizedStashId, overlays),
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];

    return scenes
      .map((scene) =>
        this.toSceneMatch(
          scene,
          config.baseUrl,
          normalizedStashId,
          overlays?.providerKey ?? null,
        ),
      )
      .filter((scene): scene is StashSceneMatch => scene !== null)
      .sort((a, b) => {
        const aHeight = a.height ?? 0;
        const bHeight = b.height ?? 0;
        if (bHeight !== aHeight) {
          return bHeight - aHeight;
        }

        return a.id.localeCompare(b.id);
      });
  }

  async getLocalSceneFeed(
    config: StashAdapterBaseConfig,
    feedConfig: StashLocalSceneFeedConfig,
  ): Promise<StashLocalSceneFeed> {
    const page = this.normalizePositiveInteger(feedConfig.page, 1);
    const perPage = this.normalizePositiveInteger(feedConfig.perPage, 16);
    const sort = this.resolveFeedSort(feedConfig.sort);
    const direction = this.resolveFeedDirection(feedConfig.direction);
    const sceneFilter = this.buildSceneFilter(feedConfig);

    const query = `
      query FindScenes($filter: FindFilterType, $sceneFilter: SceneFilterType) {
        findScenes(filter: $filter, scene_filter: $sceneFilter) {
          count
          scenes {
            id
            title
            details
            date
            paths {
              screenshot
            }
            studio {
              id
              name
              image_path
            }
            files {
              width
              height
              duration
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
        sort,
        direction,
      },
      sceneFilter,
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    const total =
      typeof payload.data?.findScenes?.count === 'number'
        ? payload.data.findScenes.count
        : 0;

    return {
      total,
      items: scenes
        .map((scene) => this.toLocalSceneFeedItem(scene, config.baseUrl))
        .filter((scene): scene is StashLocalSceneFeedItem => scene !== null),
    };
  }

  async getContinueWatchingScenes(
    config: StashAdapterBaseConfig,
    limit: number,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): Promise<StashContinueWatchingItem[]> {
    const perPage = this.normalizePositiveInteger(limit, 16);

    const query = `
      query FindScenes($filter: FindFilterType, $sceneFilter: SceneFilterType) {
        findScenes(filter: $filter, scene_filter: $sceneFilter) {
          scenes {
            id
            title
            details
            date
            resume_time
            stash_ids {
              endpoint
              stash_id
            }
            paths {
              screenshot
            }
            studio {
              id
              name
              image_path
            }
            files {
              width
              height
              duration
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page: 1,
        per_page: perPage,
        sort: 'last_played_at',
        direction: 'DESC',
      },
      sceneFilter: {
        resume_time: {
          value: 0,
          modifier: 'GREATER_THAN',
        },
      },
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];

    return scenes
      .map((scene) =>
        this.toContinueWatchingItem(
          scene,
          config.baseUrl,
          activeCatalogProviderKey,
        ),
      )
      .filter((scene): scene is StashContinueWatchingItem => scene !== null);
  }

  async getWatchProgress(
    config: StashAdapterBaseConfig,
    activeCatalogProviderKey: CatalogProviderKey | null,
    limit = 2000,
  ): Promise<StashWatchProgressItem[]> {
    const query = `
      query FindScenes($filter: FindFilterType, $sceneFilter: SceneFilterType) {
        findScenes(filter: $filter, scene_filter: $sceneFilter) {
          scenes {
            id
            resume_time
            play_count
            stash_ids {
              endpoint
              stash_id
            }
            files {
              duration
            }
          }
        }
      }
    `;

    // Scenes with a resume point, or played at least once.
    const payload = await this.executeQuery(config, query, {
      filter: {
        page: 1,
        per_page: limit,
        sort: 'last_played_at',
        direction: 'DESC',
      },
      sceneFilter: {
        resume_time: { value: 0, modifier: 'GREATER_THAN' },
        OR: {
          play_count: { value: 0, modifier: 'GREATER_THAN' },
        },
      },
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    return scenes
      .map((scene) => this.toWatchProgressItem(scene, activeCatalogProviderKey))
      .filter((item): item is StashWatchProgressItem => item !== null);
  }

  async saveSceneProgress(
    sceneId: string,
    resumeSeconds: number,
    playDuration: number | null,
    config: StashAdapterBaseConfig,
  ): Promise<void> {
    const normalizedSceneId = this.normalizeEntityId(sceneId);
    if (!normalizedSceneId) {
      return;
    }

    const mutation = `
      mutation SceneSaveActivity($id: ID!, $resumeTime: Float, $playDuration: Float) {
        sceneSaveActivity(id: $id, resume_time: $resumeTime, playDuration: $playDuration)
      }
    `;

    await this.executeQuery(config, mutation, {
      id: normalizedSceneId,
      resumeTime: Math.max(0, resumeSeconds),
      playDuration: playDuration !== null ? Math.max(0, playDuration) : null,
    });
  }

  async resetSceneProgress(
    sceneId: string,
    config: StashAdapterBaseConfig,
  ): Promise<void> {
    const normalizedSceneId = this.normalizeEntityId(sceneId);
    if (!normalizedSceneId) {
      return;
    }

    const mutation = `
      mutation SceneResetActivity($id: ID!) {
        sceneResetActivity(id: $id, reset_resume: true)
      }
    `;

    await this.executeQuery(config, mutation, {
      id: normalizedSceneId,
    });
  }

  /**
   * Back to unwatched: clears the resume point, the time played and the
   * play count, the history that makes a scene count as watched.
   */
  async markSceneUnwatched(
    sceneId: string,
    config: StashAdapterBaseConfig,
  ): Promise<void> {
    const normalizedSceneId = this.normalizeEntityId(sceneId);
    if (!normalizedSceneId) {
      return;
    }

    const mutation = `
      mutation SceneMarkUnwatched($id: ID!) {
        sceneResetActivity(id: $id, reset_resume: true, reset_duration: true)
        sceneResetPlayCount(id: $id)
      }
    `;

    await this.executeQuery(config, mutation, {
      id: normalizedSceneId,
    });
  }

  async findPerformerByStashId(
    stashId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashLocalPerformerMatch | null> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      return null;
    }

    const query = `
      query FindPerformers($performerFilter: PerformerFilterType) {
        findPerformers(performer_filter: $performerFilter) {
          performers {
            id
            favorite
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      performerFilter: {
        stash_id_endpoint: {
          modifier: 'EQUALS',
          stash_id: normalizedStashId,
        },
      },
    });

    const performers = payload.data?.findPerformers?.performers ?? [];
    const first = performers[0];
    const id = this.normalizeOptionalString(first?.id);
    if (!id) {
      return null;
    }

    return { id, favorite: first?.favorite === true };
  }

  async setPerformerFavorite(
    performerId: string,
    favorite: boolean,
    config: StashAdapterBaseConfig,
  ): Promise<void> {
    const normalizedPerformerId = this.normalizeEntityId(performerId);
    if (!normalizedPerformerId) {
      return;
    }

    const mutation = `
      mutation PerformerUpdate($id: ID!, $favorite: Boolean!) {
        performerUpdate(input: { id: $id, favorite: $favorite }) {
          id
        }
      }
    `;

    await this.executeQuery(config, mutation, {
      id: normalizedPerformerId,
      favorite,
    });
  }

  async getLocalSceneIdentityPage(
    config: StashAdapterBaseConfig,
    pageConfig: StashLocalSceneIdentityPageConfig,
  ): Promise<StashLocalSceneIdentityPage> {
    const page = this.normalizePositiveInteger(pageConfig.page, 1);
    const perPage = this.normalizePositiveInteger(pageConfig.perPage, 250);

    const query = `
      query FindScenes($filter: FindFilterType) {
        findScenes(filter: $filter) {
          count
          scenes {
            id
            stash_ids {
              endpoint
              stash_id
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
      },
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    const total =
      typeof payload.data?.findScenes?.count === 'number'
        ? payload.data.findScenes.count
        : 0;

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: scenes
        .map((scene) => this.toLocalSceneIdentityItem(scene))
        .filter(
          (scene): scene is StashLocalSceneIdentityItem => scene !== null,
        ),
    };
  }

  async getLocalLibraryScenePage(
    config: StashAdapterBaseConfig,
    pageConfig: StashLocalLibraryScenePageConfig,
    activeCatalogProviderKey?: CatalogProviderKey | null,
  ): Promise<StashLocalLibraryScenePage> {
    const page = this.normalizePositiveInteger(pageConfig.page, 1);
    const perPage = this.normalizePositiveInteger(pageConfig.perPage, 100);

    const query = `
      query FindScenes($filter: FindFilterType) {
        findScenes(filter: $filter) {
          count
          scenes {
            id
            title
            details
            date
            created_at
            updated_at
            stash_ids {
              endpoint
              stash_id
            }
            paths {
              screenshot
            }
            studio {
              id
              name
              image_path
              favorite
            }
            performers {
              id
              name
              favorite
            }
            tags {
              id
              name
              favorite
            }
            files {
              duration
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
        sort: 'updated_at',
        direction: 'DESC',
      },
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    const total =
      typeof payload.data?.findScenes?.count === 'number'
        ? payload.data.findScenes.count
        : 0;

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: scenes
        .map((scene) =>
          this.toLocalLibrarySceneItem(
            scene,
            config.baseUrl,
            activeCatalogProviderKey ?? null,
          ),
        )
        .filter((scene): scene is StashLocalLibrarySceneItem => scene !== null),
    };
  }

  async getLocalGalleryFeed(
    config: StashAdapterBaseConfig,
    feedConfig: StashLocalGalleryFeedConfig,
  ): Promise<StashLocalGalleryFeedPage> {
    const page = this.normalizePositiveInteger(feedConfig.page, 1);
    const perPage = this.normalizePositiveInteger(feedConfig.perPage, 24);

    const query = `
      query FindGalleries($filter: FindFilterType, $galleryFilter: GalleryFilterType) {
        findGalleries(filter: $filter, gallery_filter: $galleryFilter) {
          count
          galleries {
            id
            title
            date
            details
            image_count
            created_at
            updated_at
            cover {
              paths {
                thumbnail
              }
            }
            paths {
              cover
            }
            folder {
              path
            }
            files {
              path
            }
            studio {
              id
              name
              image_path
            }
            performers {
              id
              name
              image_path
            }
            tags {
              id
              name
            }
          }
        }
      }
    `;

    const titleQuery = this.normalizeOptionalString(feedConfig.titleQuery);
    const tagIds = (feedConfig.tagIds ?? [])
      .map((id) => this.normalizeEntityId(id))
      .filter((id): id is string => id !== null);
    const studioIds = (feedConfig.studioIds ?? [])
      .map((id) => this.normalizeEntityId(id))
      .filter((id): id is string => id !== null);
    const performerIds = (feedConfig.performerIds ?? [])
      .map((id) => this.normalizeEntityId(id))
      .filter((id): id is string => id !== null);

    const galleryFilter: Record<string, unknown> = {};
    if (tagIds.length > 0) {
      galleryFilter.tags = { value: tagIds, modifier: 'INCLUDES' };
    }
    if (studioIds.length > 0) {
      galleryFilter.studios = { value: studioIds, modifier: 'INCLUDES' };
    }
    if (performerIds.length > 0) {
      galleryFilter.performers = { value: performerIds, modifier: 'INCLUDES' };
    }

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
        sort: 'date',
        direction: 'DESC',
        ...(titleQuery ? { q: titleQuery } : {}),
      },
      galleryFilter: Object.keys(galleryFilter).length > 0 ? galleryFilter : undefined,
    });

    const galleries = payload.data?.findGalleries?.galleries ?? [];
    const total =
      typeof payload.data?.findGalleries?.count === 'number'
        ? payload.data.findGalleries.count
        : 0;

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: galleries
        .map((gallery) => this.toLocalGalleryFeedItem(gallery, config.baseUrl))
        .filter((gallery): gallery is StashLocalGalleryFeedItem => gallery !== null),
    };
  }

  async getGalleryById(
    galleryId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashLocalGalleryFeedItem | null> {
    const query = `
      query FindGallery($id: ID!) {
        findGallery(id: $id) {
          id
          title
          date
          details
          image_count
          created_at
          updated_at
          cover {
            paths {
              thumbnail
            }
          }
          paths {
            cover
          }
          folder {
            path
          }
          files {
            path
          }
          studio {
            id
            name
            image_path
          }
          performers {
            id
            name
            image_path
          }
          tags {
            id
            name
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, { id: galleryId });
    const gallery = payload.data?.findGallery;
    if (!gallery) {
      return null;
    }

    return this.toLocalGalleryFeedItem(gallery, config.baseUrl);
  }

  async getGalleryImages(
    galleryId: string,
    config: StashAdapterBaseConfig,
    pageConfig: { page: number; perPage: number },
  ): Promise<StashLocalGalleryImagePage> {
    const page = this.normalizePositiveInteger(pageConfig.page, 1);
    const perPage = this.normalizePositiveInteger(pageConfig.perPage, 40);

    const query = `
      query FindImages($filter: FindFilterType, $imageFilter: ImageFilterType) {
        findImages(filter: $filter, image_filter: $imageFilter) {
          count
          images {
            id
            title
            paths {
              thumbnail
              image
            }
            files {
              width
              height
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
        sort: 'path',
        direction: 'ASC',
      },
      imageFilter: {
        galleries: { value: [galleryId], modifier: 'INCLUDES' },
      },
    });

    const images = payload.data?.findImages?.images ?? [];
    const total =
      typeof payload.data?.findImages?.count === 'number'
        ? payload.data.findImages.count
        : 0;

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: images
        .map((image) => this.toLocalGalleryImage(image))
        .filter((image): image is StashLocalGalleryImage => image !== null),
    };
  }

  async searchTags(
    query: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashLocalTagOption[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const gql = `
      query FindTags($filter: FindFilterType) {
        findTags(filter: $filter) {
          tags {
            id
            name
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, gql, {
      filter: {
        q: normalizedQuery,
        page: 1,
        per_page: 25,
      },
    });

    return (payload.data?.findTags?.tags ?? [])
      .map((tag) => this.toTagOption(tag))
      .filter((tag): tag is StashLocalTagOption => tag !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async searchStudios(
    query: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashLocalStudioOption[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const gql = `
      query FindStudios($filter: FindFilterType) {
        findStudios(filter: $filter) {
          studios {
            id
            name
            parent_studio {
              id
              name
            }
            child_studios {
              id
              name
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, gql, {
      filter: {
        q: normalizedQuery,
        page: 1,
        per_page: 25,
      },
    });

    return this.toStudioOptions(payload.data?.findStudios?.studios ?? []);
  }

  async openSceneScreenshot(
    sceneId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedSceneId = this.normalizeEntityId(sceneId);
    if (!normalizedSceneId) {
      return null;
    }

    const query = `
      query FindScene($id: ID!) {
        findScene(id: $id) {
          id
          paths {
            screenshot
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedSceneId,
    });
    const screenshotUrl = this.parseAssetUrl(
      payload.data?.findScene?.paths?.screenshot,
    );
    if (!screenshotUrl) {
      return null;
    }

    return this.fetchProtectedAsset(config, screenshotUrl);
  }

  async getScenePlaybackInfo(
    sceneId: string,
    config: StashAdapterBaseConfig,
  ): Promise<{ resumeSeconds: number; duration: number | null } | null> {
    const normalizedSceneId = this.normalizeEntityId(sceneId);
    if (!normalizedSceneId) {
      return null;
    }

    const query = `
      query FindScene($id: ID!) {
        findScene(id: $id) {
          id
          resume_time
          files {
            duration
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedSceneId,
    });
    const scene = payload.data?.findScene;
    if (!scene) {
      return null;
    }

    const resumeSeconds =
      typeof scene.resume_time === 'number' && scene.resume_time > 0
        ? scene.resume_time
        : 0;
    const duration =
      typeof scene.files?.[0]?.duration === 'number'
        ? scene.files[0].duration
        : null;

    return { resumeSeconds, duration };
  }

  async getSceneStreamUrl(
    sceneId: string,
    config: StashAdapterBaseConfig,
  ): Promise<string | null> {
    return this.getSceneVideoUrl(sceneId, config, 'stream');
  }

  /**
   * Stash's generated preview clip (Tasks > Generate > Previews): a short,
   * low-resolution mp4 made for hover previews. Stash answers 404 for it
   * when it hasn't been generated.
   */
  async getScenePreviewUrl(
    sceneId: string,
    config: StashAdapterBaseConfig,
  ): Promise<string | null> {
    return this.getSceneVideoUrl(sceneId, config, 'preview');
  }

  private async getSceneVideoUrl(
    sceneId: string,
    config: StashAdapterBaseConfig,
    kind: 'stream' | 'preview',
  ): Promise<string | null> {
    const normalizedSceneId = this.normalizeEntityId(sceneId);
    if (!normalizedSceneId) {
      return null;
    }

    const query = `
      query FindScene($id: ID!) {
        findScene(id: $id) {
          id
          paths {
            ${kind}
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedSceneId,
    });
    const streamUrl = this.parseAssetUrl(payload.data?.findScene?.paths?.[kind]);
    if (!streamUrl) {
      return null;
    }

    const resolvedUrl = this.resolveProtectedAssetUrl(
      config.baseUrl,
      streamUrl,
    );
    if (!config.apiKey?.trim()) {
      return resolvedUrl;
    }

    const urlWithKey = new URL(resolvedUrl);
    urlWithKey.searchParams.set('apikey', config.apiKey.trim());
    return urlWithKey.toString();
  }

  async openStudioLogo(
    studioId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedStudioId = this.normalizeEntityId(studioId);
    if (!normalizedStudioId) {
      return null;
    }

    const query = `
      query FindStudio($id: ID!) {
        findStudio(id: $id) {
          id
          image_path
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedStudioId,
    });
    const imageUrl = this.parseAssetUrl(payload.data?.findStudio?.image_path);
    if (!imageUrl) {
      return null;
    }

    return this.fetchProtectedAsset(config, imageUrl);
  }

  async openPerformerPhoto(
    performerId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedPerformerId = this.normalizeEntityId(performerId);
    if (!normalizedPerformerId) {
      return null;
    }

    const query = `
      query FindPerformer($id: ID!) {
        findPerformer(id: $id) {
          id
          image_path
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedPerformerId,
    });
    const imageUrl = this.parseAssetUrl(payload.data?.findPerformer?.image_path);
    if (!imageUrl) {
      return null;
    }

    return this.fetchProtectedAsset(config, imageUrl);
  }

  // Typed entry point for feature clients that keep their own GraphQL
  // documents (e.g. groups), so they share this adapter's endpoint, auth,
  // error handling and runtime-health reporting.
  async graphql<TData>(
    config: StashAdapterBaseConfig,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<TData | undefined> {
    const payload = await this.executeQuery(config, query, variables);
    return payload.data as TData | undefined;
  }

  // A group's front image, or -- when it has none (Stash then serves a
  // generated placeholder, flagged with default=true) -- the screenshot of
  // its first scene.
  async openGroupCover(
    groupId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedGroupId = this.normalizeEntityId(groupId);
    if (!normalizedGroupId) {
      return null;
    }

    const query = `
      query FindGroupCover($id: ID!) {
        findGroup(id: $id) {
          id
          front_image_path
          scenes {
            id
            paths {
              screenshot
            }
            groups {
              group {
                id
              }
              scene_index
            }
          }
        }
      }
    `;

    const data = await this.graphql<{
      findGroup?: {
        front_image_path?: unknown;
        scenes?: Array<{
          id: string;
          paths?: { screenshot?: unknown };
          groups?: Array<{ group?: { id?: string }; scene_index?: number | null }>;
        }>;
      } | null;
    }>(config, query, { id: normalizedGroupId });
    const group = data?.findGroup;
    if (!group) {
      return null;
    }

    const frontImage = this.parseAssetUrl(group.front_image_path);
    if (frontImage && !/[?&]default=true\b/.test(frontImage)) {
      return this.fetchProtectedAsset(config, frontImage);
    }

    const indexIn = (scene: NonNullable<typeof group.scenes>[number]): number =>
      scene.groups?.find((entry) => entry.group?.id === normalizedGroupId)?.scene_index ??
      Number.MAX_SAFE_INTEGER;
    const firstScene = [...(group.scenes ?? [])].sort((a, b) => indexIn(a) - indexIn(b))[0];
    const screenshot = this.parseAssetUrl(firstScene?.paths?.screenshot);
    return screenshot ? this.fetchProtectedAsset(config, screenshot) : null;
  }

  async openGalleryCover(
    galleryId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedGalleryId = this.normalizeEntityId(galleryId);
    if (!normalizedGalleryId) {
      return null;
    }

    const query = `
      query FindGallery($id: ID!) {
        findGallery(id: $id) {
          id
          cover {
            paths {
              thumbnail
            }
          }
          paths {
            cover
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedGalleryId,
    });
    const gallery = payload.data?.findGallery;
    const coverUrl =
      this.parseAssetUrl(gallery?.cover?.paths?.thumbnail) ??
      this.parseAssetUrl(gallery?.paths?.cover);
    if (!coverUrl) {
      return null;
    }

    return this.fetchProtectedAsset(config, coverUrl);
  }

  async openImageThumbnail(
    imageId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    return this.openImageAsset(imageId, config, 'thumbnail');
  }

  async openImageFull(
    imageId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    return this.openImageAsset(imageId, config, 'image');
  }

  private async openImageAsset(
    imageId: string,
    config: StashAdapterBaseConfig,
    variant: 'thumbnail' | 'image',
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedImageId = this.normalizeEntityId(imageId);
    if (!normalizedImageId) {
      return null;
    }

    const query = `
      query FindImage($id: ID!) {
        findImage(id: $id) {
          id
          paths {
            thumbnail
            image
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedImageId,
    });
    const paths = payload.data?.findImage?.paths;
    const assetUrl = this.parseAssetUrl(
      variant === 'thumbnail' ? paths?.thumbnail : paths?.image,
    );
    if (!assetUrl) {
      return null;
    }

    return this.fetchProtectedAsset(config, assetUrl);
  }

  private pickBestResolution(
    files: Array<{ width?: unknown; height?: unknown }>,
  ): { width: number | null; height: number | null } {
    if (files.length === 0) {
      return { width: null, height: null };
    }

    return files.reduce<{ width: number | null; height: number | null }>(
      (best, file) => {
        const width = typeof file.width === 'number' ? file.width : null;
        const height = typeof file.height === 'number' ? file.height : null;
        const bestHeight = best.height ?? 0;
        const currentHeight = height ?? 0;

        if (currentHeight > bestHeight) {
          return { width, height };
        }

        if (currentHeight === bestHeight) {
          const bestWidth = best.width ?? 0;
          const currentWidth = width ?? 0;
          if (currentWidth > bestWidth) {
            return { width, height };
          }
        }

        return best;
      },
      { width: null, height: null },
    );
  }

  private buildSceneLabel(id: string, height: number | null): string {
    if (height && height > 0) {
      return `${height}p`;
    }

    return `Scene #${id}`;
  }

  private async fetchProtectedAsset(
    config: StashAdapterBaseConfig,
    assetUrl: string,
  ): Promise<StashProtectedAssetResponse | null> {
    const resolvedUrl = this.resolveProtectedAssetUrl(config.baseUrl, assetUrl);
    const headers: Record<string, string> = {};
    if (config.apiKey?.trim()) {
      headers.ApiKey = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(resolvedUrl, { headers });
    } catch (error) {
      await this.reportRuntimeFailure(error);
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (response.status === 404) {
      await this.reportRuntimeSuccess();
      return null;
    }

    if (!response.ok) {
      await this.reportRuntimeFailure(
        `Stash provider returned ${response.status} for media request.`,
      );
      throw new BadGatewayException(
        `Stash provider returned ${response.status} for media request.`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await this.reportRuntimeSuccess();

    return {
      body: buffer,
      contentType: response.headers.get('content-type'),
      contentLength: String(buffer.byteLength),
      cacheControl: response.headers.get('cache-control'),
    };
  }

  private toLocalSceneFeedItem(
    scene: StashLocalSceneRecord,
    baseUrl: string,
  ): StashLocalSceneFeedItem | null {
    if (typeof scene.id !== 'string' || scene.id.trim().length === 0) {
      return null;
    }

    const title =
      typeof scene.title === 'string' && scene.title.trim().length > 0
        ? scene.title.trim()
        : `Scene #${scene.id}`;
    const description =
      typeof scene.details === 'string' && scene.details.trim().length > 0
        ? scene.details.trim()
        : null;
    const releaseDate =
      typeof scene.date === 'string' && scene.date.trim().length > 0
        ? scene.date.trim()
        : null;
    const imageUrl =
      scene.paths &&
      typeof scene.paths.screenshot === 'string' &&
      scene.paths.screenshot.trim().length > 0
        ? scene.paths.screenshot.trim()
        : null;
    const studioId =
      scene.studio &&
      typeof scene.studio.id === 'string' &&
      scene.studio.id.trim().length > 0
        ? scene.studio.id.trim()
        : null;
    const studio =
      scene.studio &&
      typeof scene.studio.name === 'string' &&
      scene.studio.name.trim().length > 0
        ? scene.studio.name.trim()
        : null;
    const studioImageUrl =
      scene.studio &&
      typeof scene.studio.image_path === 'string' &&
      scene.studio.image_path.trim().length > 0
        ? scene.studio.image_path.trim()
        : null;
    const { width, height } = this.pickBestResolution(scene.files ?? []);
    const duration = this.pickFirstDuration(scene.files ?? []);

    return {
      id: scene.id,
      title,
      description,
      imageUrl,
      cardImageUrl: imageUrl,
      studioId,
      studio,
      studioImageUrl,
      releaseDate,
      duration,
      viewUrl: this.resolveSceneViewUrl(baseUrl, scene.id),
    };
  }

  private toContinueWatchingItem(
    scene: StashLocalSceneRecord,
    baseUrl: string,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): StashContinueWatchingItem | null {
    const feedItem = this.toLocalSceneFeedItem(scene, baseUrl);
    if (!feedItem) {
      return null;
    }

    const resumeSeconds =
      typeof scene.resume_time === 'number' && scene.resume_time > 0
        ? scene.resume_time
        : null;
    if (resumeSeconds === null || !feedItem.duration || feedItem.duration <= 0) {
      return null;
    }

    const progressPercent = Math.min(
      100,
      Math.round((resumeSeconds / feedItem.duration) * 100),
    );

    // A scene left within the last few percent of its runtime is effectively
    // finished — Stash doesn't always clear resume_time on completion.
    if (progressPercent >= 95) {
      return null;
    }

    const linkedEntries = Array.isArray(scene.stash_ids)
      ? scene.stash_ids
          .map((entry) => this.toLinkedSceneStashId(entry))
          .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
      : [];
    const linkedCatalogRefs = this.toLinkedCatalogRefs(linkedEntries);
    const activeCatalogSceneId = activeCatalogProviderKey
      ? findCatalogExternalIdForProvider(linkedCatalogRefs, activeCatalogProviderKey)
      : null;

    return {
      ...feedItem,
      activeCatalogSceneId,
      resumeSeconds,
      progressPercent,
    };
  }

  private toWatchProgressItem(
    scene: StashLocalSceneRecord,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): StashWatchProgressItem | null {
    const id = this.normalizeOptionalString(scene.id);
    if (!id) {
      return null;
    }

    const duration = this.pickFirstDuration(scene.files ?? []);
    const resumeSeconds =
      typeof scene.resume_time === 'number' && scene.resume_time > 0
        ? scene.resume_time
        : 0;
    const played = typeof scene.play_count === 'number' && scene.play_count > 0;

    let progressPercent: number;
    if (resumeSeconds > 0 && duration && duration > 0) {
      progressPercent = Math.min(100, Math.max(1, Math.round((resumeSeconds / duration) * 100)));
      // Left within the last few percent: effectively finished.
      if (progressPercent >= 95) {
        progressPercent = 100;
      }
    } else if (played) {
      progressPercent = 100;
    } else {
      return null;
    }

    const linkedEntries = Array.isArray(scene.stash_ids)
      ? scene.stash_ids
          .map((entry) => this.toLinkedSceneStashId(entry))
          .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
      : [];
    const activeCatalogSceneId = activeCatalogProviderKey
      ? findCatalogExternalIdForProvider(
          this.toLinkedCatalogRefs(linkedEntries),
          activeCatalogProviderKey,
        )
      : null;

    return { id, activeCatalogSceneId, progressPercent };
  }

  private toLocalSceneIdentityItem(
    scene: StashLocalSceneRecord,
  ): StashLocalSceneIdentityItem | null {
    const id = this.normalizeOptionalString(scene.id);
    if (!id) {
      return null;
    }

    const linkedStashIds = Array.isArray(scene.stash_ids)
      ? scene.stash_ids
          .map((entry) => this.toLinkedSceneStashId(entry))
          .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
      : [];

    return {
      id,
      linkedStashIds,
    };
  }

  private toLinkedSceneStashId(value: {
    endpoint?: unknown;
    stash_id?: unknown;
  }): StashLinkedSceneStashId | null {
    const endpoint = this.normalizeOptionalString(value.endpoint);
    const stashId = this.normalizeOptionalString(value.stash_id);
    if (!endpoint || !stashId) {
      return null;
    }

    return {
      endpoint,
      stashId,
    };
  }

  private toLocalLibrarySceneItem(
    scene: StashLocalSceneRecord,
    baseUrl: string,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): StashLocalLibrarySceneItem | null {
    const id = this.normalizeOptionalString(scene.id);
    if (!id) {
      return null;
    }

    const linkedEntries = Array.isArray(scene.stash_ids)
      ? scene.stash_ids
          .map((entry) => this.toLinkedSceneStashId(entry))
          .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
      : [];
    const linkedCatalogRefs = this.toLinkedCatalogRefs(linkedEntries);
    const performers = this.toNamedEntities(scene.performers ?? []);
    const tags = this.toNamedEntities(scene.tags ?? []);
    const duration = this.pickFirstDuration(scene.files ?? []);

    return {
      id,
      activeCatalogSceneId: activeCatalogProviderKey
        ? findCatalogExternalIdForProvider(
            linkedCatalogRefs,
            activeCatalogProviderKey,
          )
        : null,
      linkedCatalogRefs,
      title: this.normalizeOptionalString(scene.title) ?? `Scene #${id}`,
      description: this.normalizeOptionalString(scene.details),
      imageUrl: this.parseAssetUrl(scene.paths?.screenshot),
      studioId: this.normalizeOptionalString(scene.studio?.id),
      studio: this.normalizeOptionalString(scene.studio?.name),
      studioImageUrl: this.normalizeOptionalString(scene.studio?.image_path),
      performerIds: performers.ids,
      performerNames: performers.names,
      tagIds: tags.ids,
      tagNames: tags.names,
      releaseDate: this.normalizeOptionalString(scene.date),
      duration,
      viewUrl: this.resolveSceneViewUrl(baseUrl, id),
      createdAt: this.parseOptionalDate(scene.created_at),
      updatedAt: this.parseOptionalDate(scene.updated_at),
      hasFavoritePerformer: Array.isArray(scene.performers)
        ? scene.performers.some((performer) => performer?.favorite === true)
        : false,
      favoriteStudio: scene.studio?.favorite === true,
      hasFavoriteTag: Array.isArray(scene.tags)
        ? scene.tags.some((tag) => tag?.favorite === true)
        : false,
    };
  }

  private toLocalGalleryFeedItem(
    gallery: StashGalleryRecord,
    baseUrl: string,
  ): StashLocalGalleryFeedItem | null {
    const id = this.normalizeOptionalString(gallery.id);
    if (!id) {
      return null;
    }

    const performers = (gallery.performers ?? [])
      .map((performer): StashLocalGalleryPerformer | null => {
        const performerId = this.normalizeOptionalString(performer?.id);
        const performerName = this.normalizeOptionalString(performer?.name);
        if (!performerId || !performerName) {
          return null;
        }

        return {
          id: performerId,
          name: performerName,
          imageUrl: this.normalizeOptionalString(performer?.image_path),
        };
      })
      .filter((performer): performer is StashLocalGalleryPerformer => performer !== null);
    const tags = this.toNamedEntities(gallery.tags ?? []);
    const imageCount =
      typeof gallery.image_count === 'number' ? gallery.image_count : 0;

    return {
      id,
      title: this.resolveGalleryTitle(gallery, id),
      description: this.normalizeOptionalString(gallery.details),
      // gallery.cover is an optional relation and is often null even for
      // galleries with real photos; gallery.paths.cover is a flat URL Stash
      // always serves dynamically, so it's the more reliable fallback.
      coverImageUrl:
        this.parseAssetUrl(gallery.cover?.paths?.thumbnail) ??
        this.parseAssetUrl(gallery.paths?.cover),
      studioId: this.normalizeOptionalString(gallery.studio?.id),
      studio: this.normalizeOptionalString(gallery.studio?.name),
      studioImageUrl: this.normalizeOptionalString(gallery.studio?.image_path),
      performers,
      tagIds: tags.ids,
      tagNames: tags.names,
      imageCount,
      releaseDate: this.normalizeOptionalString(gallery.date),
      viewUrl: this.resolveGalleryViewUrl(baseUrl, id),
      createdAt: this.parseOptionalDate(gallery.created_at),
      updatedAt: this.parseOptionalDate(gallery.updated_at),
    };
  }

  // Falls back to the gallery's folder/zip name when Stash has no title set
  // (common for galleries that were just scanned and never manually
  // named) -- much more useful than a placeholder like "Gallery #123".
  private resolveGalleryTitle(gallery: StashGalleryRecord, id: string): string {
    const title = this.normalizeOptionalString(gallery.title);
    if (title) {
      return title;
    }

    const folderPath = this.normalizeOptionalString(gallery.folder?.path);
    const folderName = this.lastPathSegment(folderPath);
    if (folderName) {
      return folderName;
    }

    const firstFilePath = this.normalizeOptionalString(gallery.files?.[0]?.path);
    const fileName = this.lastPathSegment(firstFilePath);
    if (fileName) {
      return fileName;
    }

    return `Gallery #${id}`;
  }

  private lastPathSegment(path: string | null): string | null {
    if (!path) {
      return null;
    }

    const segments = path.split(/[/\\]/).filter((segment) => segment.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : null;
  }

  private toLocalGalleryImage(image: StashImageRecord): StashLocalGalleryImage | null {
    const id = this.normalizeOptionalString(image.id);
    if (!id) {
      return null;
    }

    const firstFile = (image.files ?? [])[0];

    return {
      id,
      title: this.normalizeOptionalString(image.title),
      imageUrl: this.parseAssetUrl(image.paths?.image),
      thumbnailUrl: this.parseAssetUrl(image.paths?.thumbnail),
      width: typeof firstFile?.width === 'number' ? firstFile.width : null,
      height: typeof firstFile?.height === 'number' ? firstFile.height : null,
    };
  }

  private toSceneMatch(
    scene: StashLocalSceneRecord,
    baseUrl: string,
    stashId: string,
    providerKey: CatalogProviderKey | null,
  ): StashSceneMatch | null {
    const id = this.normalizeOptionalString(scene.id);
    if (!id) {
      return null;
    }

    if (providerKey) {
      const linkedEntries = Array.isArray(scene.stash_ids)
        ? scene.stash_ids
            .map((entry) => this.toLinkedSceneStashId(entry))
            .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
        : [];
      const linkedCatalogRefs = this.toLinkedCatalogRefs(linkedEntries);

      if (!hasCatalogSceneRef(linkedCatalogRefs, providerKey, stashId)) {
        return null;
      }
    }

    const { width, height } = this.pickBestResolution(scene.files ?? []);
    const duration =
      typeof scene.files?.[0]?.duration === 'number'
        ? scene.files[0].duration
        : null;
    const resumeSeconds =
      typeof scene.resume_time === 'number' && scene.resume_time > 0
        ? scene.resume_time
        : 0;

    return {
      id,
      width,
      height,
      viewUrl: this.resolveSceneViewUrl(baseUrl, id),
      label: this.buildSceneLabel(id, height),
      duration,
      resumeSeconds,
    };
  }

  private buildSceneFilter(
    feedConfig: StashLocalSceneFeedConfig,
  ): Record<string, unknown> | undefined {
    const titleQuery = this.normalizeOptionalString(feedConfig.titleQuery);
    const tagIds = this.normalizeStringArray(feedConfig.tagIds);
    const studioIds = this.normalizeStringArray(feedConfig.studioIds);
    const favoritePerformersOnly = feedConfig.favoritePerformersOnly === true;
    const favoriteStudiosOnly = feedConfig.favoriteStudiosOnly === true;
    const favoriteTagsOnly = feedConfig.favoriteTagsOnly === true;
    const filter: Record<string, unknown> = {};

    if (titleQuery) {
      filter['title'] = {
        value: titleQuery,
        modifier: 'INCLUDES',
      };
    }

    if (tagIds.length > 0) {
      filter['tags'] = {
        value: tagIds,
        modifier: feedConfig.tagMode === 'AND' ? 'INCLUDES_ALL' : 'INCLUDES',
      };
    }

    if (studioIds.length > 0) {
      filter['studios'] = {
        value: studioIds,
        modifier: 'INCLUDES',
      };
    }

    if (favoritePerformersOnly) {
      filter['performers_filter'] = {
        filter_favorites: true,
      };
    }

    if (favoriteStudiosOnly) {
      filter['studios_filter'] = {
        favorite: true,
      };
    }

    if (favoriteTagsOnly) {
      filter['tags_filter'] = {
        favorite: true,
      };
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private buildSceneMatchFilter(
    stashId: string,
    overlays?: StashSceneMatchOverlayConfig,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      stash_id_endpoint: {
        modifier: 'EQUALS',
        stash_id: stashId,
      },
    };

    if (overlays?.favoritePerformersOnly === true) {
      filter['performers_filter'] = {
        filter_favorites: true,
      };
    }

    if (overlays?.favoriteStudiosOnly === true) {
      filter['studios_filter'] = {
        favorite: true,
      };
    }

    if (overlays?.favoriteTagsOnly === true) {
      filter['tags_filter'] = {
        favorite: true,
      };
    }

    return filter;
  }

  private toTagOption(tag: StashTagRecord): StashLocalTagOption | null {
    const id = this.normalizeOptionalString(tag.id);
    const name = this.normalizeOptionalString(tag.name);
    if (!id || !name) {
      return null;
    }

    return { id, name };
  }

  private toNamedEntities(
    values: Array<{ id?: unknown; name?: unknown } | null | undefined>,
  ): { ids: string[]; names: string[] } {
    const deduped = new Map<string, string>();

    for (const value of values) {
      const id = this.normalizeOptionalString(value?.id);
      const name = this.normalizeOptionalString(value?.name);
      if (!id || !name || deduped.has(id)) {
        continue;
      }

      deduped.set(id, name);
    }

    return {
      ids: [...deduped.keys()],
      names: [...deduped.values()],
    };
  }

  private toLinkedCatalogRefs(
    linkedEntries: StashLinkedSceneStashId[],
  ): string[] {
    return normalizeCatalogSceneRefs(
      linkedEntries.map((entry) => ({
        endpoint: entry.endpoint,
        externalId: entry.stashId,
      })),
    );
  }

  private toStudioOptions(
    studios: StashStudioSearchRecord[],
  ): StashLocalStudioOption[] {
    const grouped = new Map<
      string,
      {
        id: string;
        name: string;
        childStudios: Map<string, string>;
      }
    >();

    for (const studio of studios) {
      const studioId = this.normalizeOptionalString(studio.id);
      const studioName = this.normalizeOptionalString(studio.name);
      if (!studioId || !studioName) {
        continue;
      }

      const parentId = this.normalizeOptionalString(studio.parent_studio?.id);
      const parentName = this.normalizeOptionalString(
        studio.parent_studio?.name,
      );

      if (parentId && parentName) {
        const group = this.getOrCreateStudioGroup(
          grouped,
          parentId,
          parentName,
        );
        group.childStudios.set(studioId, studioName);
        continue;
      }

      const group = this.getOrCreateStudioGroup(grouped, studioId, studioName);
      for (const child of studio.child_studios ?? []) {
        const childId = this.normalizeOptionalString(child.id);
        const childName = this.normalizeOptionalString(child.name);
        if (childId && childName) {
          group.childStudios.set(childId, childName);
        }
      }
    }

    return [...grouped.values()]
      .map((group) => ({
        id: group.id,
        name: group.name,
        childStudios: [...group.childStudios.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private getOrCreateStudioGroup(
    groups: Map<
      string,
      {
        id: string;
        name: string;
        childStudios: Map<string, string>;
      }
    >,
    id: string,
    name: string,
  ) {
    const existing = groups.get(id);
    if (existing) {
      return existing;
    }

    const created = {
      id,
      name,
      childStudios: new Map<string, string>(),
    };
    groups.set(id, created);
    return created;
  }

  private pickFirstDuration(
    files: Array<{ duration?: unknown }>,
  ): number | null {
    for (const file of files) {
      if (typeof file.duration === 'number' && Number.isFinite(file.duration)) {
        return file.duration;
      }
    }

    return null;
  }

  private normalizeEntityId(id: string): string | null {
    const normalized = id.trim();
    return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
  }

  private normalizeOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private normalizeStringArray(values: string[] | undefined): string[] {
    const deduped = new Set<string>();
    for (const value of values ?? []) {
      const normalized = this.normalizeOptionalString(value);
      if (normalized) {
        deduped.add(normalized);
      }
    }

    return [...deduped];
  }

  private parseAssetUrl(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private parseOptionalDate(value: unknown): Date | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolveProtectedAssetUrl(baseUrl: string, assetUrl: string): string {
    const base = new URL(baseUrl);
    const candidate = new URL(assetUrl, base);

    if (candidate.origin !== base.origin) {
      throw new BadGatewayException(
        'Stash provider returned an unexpected media URL.',
      );
    }

    return candidate.toString();
  }

  private resolveFeedSort(sort: StashSceneFeedSort): string {
    switch (sort) {
      case 'CREATED_AT':
        return 'created_at';
      case 'UPDATED_AT':
        return 'updated_at';
      case 'TITLE':
        return 'title';
      default:
        return 'created_at';
    }
  }

  private resolveFeedDirection(direction: StashSceneFeedDirection): string {
    return direction === 'ASC' ? 'ASC' : 'DESC';
  }

  private normalizePositiveInteger(value: number, fallback: number): number {
    const normalized = Math.floor(Number(value));
    return normalized > 0 ? normalized : fallback;
  }

  private async executeQuery(
    config: StashAdapterBaseConfig,
    query: string,
    variables?: Record<string, unknown>,
    trackRuntimeHealth = true,
  ): Promise<StashGraphqlResponse> {
    const endpoint = this.resolveGraphqlEndpoint(config.baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (config.apiKey?.trim()) {
      headers.ApiKey = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      if (trackRuntimeHealth) {
        await this.reportRuntimeFailure(error);
      }
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (!response.ok) {
      const errorBody = await response.text();
      if (trackRuntimeHealth) {
        await this.reportRuntimeFailure(
          `Stash provider returned ${response.status}: ${errorBody}`,
        );
      }
      throw new BadGatewayException(
        `Stash provider returned ${response.status}: ${errorBody}`,
      );
    }

    const payload = (await response.json()) as StashGraphqlResponse;

    if (payload.errors && payload.errors.length > 0) {
      const firstError = payload.errors[0]?.message;
      const message =
        typeof firstError === 'string' && firstError.length > 0
          ? firstError
          : 'Stash GraphQL request failed.';
      if (trackRuntimeHealth) {
        await this.reportRuntimeFailure(message);
      }
      throw new BadGatewayException(message);
    }

    if (trackRuntimeHealth) {
      await this.reportRuntimeSuccess();
    }

    return payload;
  }

  private async reportRuntimeSuccess(): Promise<void> {
    try {
      await this.runtimeHealthService.recordSuccess(RuntimeHealthServiceKey.STASH);
    } catch (error) {
      this.logger.warn(
        `Failed to record Stash runtime recovery: ${this.errorMessage(error)}`,
      );
    }
  }

  private async reportRuntimeFailure(error: unknown): Promise<void> {
    try {
      await this.runtimeHealthService.recordFailure(
        RuntimeHealthServiceKey.STASH,
        error,
      );
    } catch (reportingError) {
      this.logger.warn(
        `Failed to record Stash runtime failure: ${this.errorMessage(reportingError)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return 'unknown error';
  }

  private resolveGraphqlEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    if (cleanPath.endsWith('/graphql')) {
      return parsed.toString();
    }

    parsed.pathname = `${cleanPath}/graphql`;
    return parsed.toString();
  }

  resolveSceneViewUrl(baseUrl: string, sceneId: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/scenes/${encodeURIComponent(sceneId)}`;
    parsed.search = '';
    return parsed.toString();
  }

  private resolveGalleryViewUrl(baseUrl: string, galleryId: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/galleries/${encodeURIComponent(galleryId)}`;
    parsed.search = '';
    return parsed.toString();
  }
}
