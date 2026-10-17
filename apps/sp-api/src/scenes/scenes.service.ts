import { pornhubEmbedUrl } from './streaming/pornhub-embed.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PerformerFavoritesService } from '../performers/performer-favorites.service';
import { PerformerImagePreferenceService } from '../performers/performer-image-preference.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import {
  type CatalogProviderIntegrationType,
  type CatalogProviderKey,
} from '../providers/catalog/catalog-provider.util';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { StashdbScene } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import {
  SceneStatusDto,
  isSceneStatusRequestable,
} from '../scene-status/dto/scene-status.dto';
import { filterExcludedNetworkScenes } from '../scene-status/exclude-network-scenes.util';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AppSettingsService } from '../settings/app-settings.service';
import { StudioFavoritesService } from '../studios/studio-favorites.service';
import { TpdbWebService } from '../tpdb-web/tpdb-web.service';
import { SceneTagOptionDto } from './dto/scene-tag-option.dto';
import {
  SceneDetailsDto,
  SceneStashAvailabilityDto,
  SceneWhisparrAvailabilityDto,
} from './dto/scene-details.dto';
import {
  ScenesFeedResponseDto,
  SimilarScenesResponseDto,
} from './dto/scenes-feed.dto';
import {
  SceneFavoritesFilter,
  SceneFeedSort,
  SortDirection,
  SceneTagMatchMode,
} from './dto/scenes-query.dto';

// Read-ahead state for one filtered feed (see getFilteredScenesFeed).
interface FilteredFeedState {
  scenes: StashdbScene[];
  seen: Set<string>;
  nextProviderPage: number;
  exhausted: boolean;
  providerTotal: number;
  expiresAt: number;
}

@Injectable()
export class ScenesService {
  /** How long a filtered feed's read-ahead is reused while scrolling. */
  private static readonly FILTERED_FEED_TTL_MS = 10 * 60 * 1000;
  /** Provider pages fetched in parallel per read-ahead step. */
  private static readonly FILTERED_FEED_PARALLEL_PAGES = 6;
  /** Upper bound on provider pages fetched for one request. */
  private static readonly FILTERED_FEED_MAX_PAGES_PER_REQUEST = 36;
  private static readonly FILTERED_FEED_CACHE_LIMIT = 50;
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;

  // Bounded by favorited-performer count, not catalog size -- see
  // getFavoritePerformerScenesFeed.
  private static readonly FAVORITE_PERFORMER_SCENES_PER_PERFORMER_CAP = 60;

  // Same per-performer cap and reasoning as the favorites feed above --
  // bounded by the current scene's own cast size, not catalog size. Newest
  // scenes only per performer, so a library scene older than a cast
  // member's most recent 60 releases won't surface here.
  private static readonly SIMILAR_SCENES_PER_PERFORMER_CAP = 60;
  private static readonly SIMILAR_SCENES_DEFAULT_LIMIT = 12;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly sceneStatusService: SceneStatusService,
    private readonly stashAdapter: StashAdapter,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly appSettingsService: AppSettingsService,
    private readonly performerFavoritesService: PerformerFavoritesService,
    private readonly performerImagePreferenceService: PerformerImagePreferenceService,
    private readonly tpdbWebService: TpdbWebService,
    private readonly studioFavoritesService: StudioFavoritesService,
  ) {}

  async getScenesFeed(
    page = ScenesService.DEFAULT_PAGE,
    perPage = ScenesService.DEFAULT_PER_PAGE,
    sort: SceneFeedSort = 'TRENDING',
    direction: SortDirection = 'DESC',
    tagIds: string[] = [],
    tagMode: SceneTagMatchMode = 'OR',
    favorites?: SceneFavoritesFilter,
    studioIds: string[] = [],
    titleQuery?: string,
  ): Promise<ScenesFeedResponseDto> {
    const normalizedStudioIds = this.normalizeStudioIds(studioIds);

    // TPDB has no server-side "favorite performer" filter at all (confirmed
    // live: the field never appears on any scene/performer response), so
    // asking it for favorites: PERFORMER silently returns the unfiltered
    // feed. Since favorites are tracked locally and expected to be a small
    // curated list, build this from each favorited performer's own scenes
    // instead of relying on the provider.
    if (favorites === 'PERFORMER') {
      return this.getFavoritePerformerScenesFeed(
        page,
        perPage,
        sort,
        direction,
        normalizedStudioIds,
        titleQuery,
        { tagIds: this.normalizeTagIds(tagIds), mode: tagMode },
      );
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const normalizedTagIds = this.normalizeTagIds(tagIds);
    // Favorite studios: TPDB ignores favorites: STUDIO, so when studios are
    // favorited in Peeparr the feed asks for those studios by id instead
    // (narrowed to any studios already selected).
    let providerFavorites = favorites;
    let providerStudioIds = normalizedStudioIds;
    if (favorites === 'STUDIO') {
      const localFavoriteStudioIds =
        await this.studioFavoritesService.listAllFavoriteIds();
      if (localFavoriteStudioIds.length > 0) {
        providerFavorites = undefined;
        providerStudioIds =
          normalizedStudioIds.length > 0
            ? normalizedStudioIds.filter((id) =>
                localFavoriteStudioIds.includes(id),
              )
            : localFavoriteStudioIds;
        if (providerStudioIds.length === 0) {
          return { total: 0, page, perPage, hasMore: false, items: [] };
        }
      }
    }
    const fetchProviderPage = (providerPage: number) =>
      catalogAdapter.getScenesBySort({
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
        page: providerPage,
        perPage,
        sort,
        direction,
        favorites: providerFavorites,
        studioIds: providerStudioIds,
        titleQuery,
        tagFilter:
          normalizedTagIds.length > 0
            ? {
                tagIds: normalizedTagIds,
                mode: tagMode,
              }
            : undefined,
      });
    const appSettings = await this.appSettingsService.get();

    // TPDB "Popular": the website's popular scenes (read with the saved TPDB
    // website login). Without them, the latest releases, flagged so the page
    // can say why.
    const isTpdbPopularFeed =
      catalogProvider.integrationType === 'TPDB' &&
      sort === 'TRENDING' &&
      !favorites &&
      normalizedTagIds.length === 0 &&
      normalizedStudioIds.length === 0 &&
      !titleQuery?.trim();
    let popularUnavailable = false;
    if (isTpdbPopularFeed) {
      const popularScenes = await this.tpdbWebService.getPopularScenes({
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
      });
      if (popularScenes.length > 0) {
        return this.pageFixedScenes(
          popularScenes,
          page,
          perPage,
          catalogProvider.integrationType,
          appSettings.hideAmateurNetworkResults,
        );
      }
      popularUnavailable = true;
    }
    const withNotice = (feed: ScenesFeedResponseDto): ScenesFeedResponseDto =>
      popularUnavailable ? { ...feed, popularUnavailable: true } : feed;

    // Hiding amateur networks can remove most of a provider page (TPDB's
    // newest scenes are often almost all ManyVids), which left pages near
    // empty: read ahead until there's a full page to show.
    if (appSettings.hideAmateurNetworkResults) {
      return withNotice(
        await this.getFilteredScenesFeed(
          JSON.stringify([
            catalogProvider.integrationType,
            perPage,
            sort,
            direction,
            normalizedTagIds,
            tagMode,
            favorites ?? null,
            normalizedStudioIds,
            titleQuery?.trim() ?? '',
          ]),
          page,
          perPage,
          catalogProvider.integrationType,
          fetchProviderPage,
        ),
      );
    }

    const scenes = await fetchProviderPage(page);
    const statuses = await this.sceneStatusService.resolveForScenes(
      scenes.scenes.map((scene) => scene.id),
    );
    const visibleScenes = filterExcludedNetworkScenes(
      scenes.scenes,
      statuses,
      appSettings.hideAmateurNetworkResults,
    );

    const streaming = await this.streamsFromPornhub();
    return withNotice({
      // total/hasMore still reflect the catalog provider's raw, unfiltered
      // count -- there's no way to know "is this scene already in my
      // library" without resolving status locally, so an excluded-network
      // scene can't be excluded from the provider's own pagination math.
      // Worst case this slightly overstates the count and infinite-scroll
      // makes one extra (empty) request at the very end of a feed.
      total: scenes.total,
      page,
      perPage,
      hasMore: page * perPage < scenes.total,
      items: visibleScenes.map((scene) => {
        const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          scene,
          catalogProvider.integrationType,
          status,
          isSceneStatusRequestable(status),
          streaming,
        );
      }),
    });
  }

  private readonly filteredFeeds = new Map<string, FilteredFeedState>();

  /**
   * Only the TPDB website's popular scenes (for Home), with statuses; empty
   * when the catalog isn't TPDB or no working website login is saved.
   */
  async getPopularScenes(): Promise<ScenesFeedResponseDto> {
    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const empty = { total: 0, page: 1, perPage: 0, hasMore: false, items: [] };
    if (catalogProvider.integrationType !== 'TPDB') {
      return empty;
    }

    const [scenes, appSettings] = await Promise.all([
      this.tpdbWebService.getPopularScenes({
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
      }),
      this.appSettingsService.get(),
    ]);
    if (scenes.length === 0) {
      return empty;
    }

    return this.pageFixedScenes(
      scenes,
      1,
      scenes.length,
      catalogProvider.integrationType,
      appSettings.hideAmateurNetworkResults,
    );
  }

  // One page of a fixed list of scenes (e.g. the TPDB website's popular
  // scenes), amateur-network ones hidden if asked, with fresh statuses.
  private async pageFixedScenes(
    scenes: StashdbScene[],
    page: number,
    perPage: number,
    integrationType: CatalogProviderIntegrationType,
    hideAmateurNetworkResults: boolean,
  ): Promise<ScenesFeedResponseDto> {
    const allStatuses = await this.sceneStatusService.resolveForScenes(
      scenes.map((scene) => scene.id),
    );
    const visible = filterExcludedNetworkScenes(
      scenes,
      allStatuses,
      hideAmateurNetworkResults,
    );
    const pageScenes = visible.slice((page - 1) * perPage, page * perPage);
    const streaming = await this.streamsFromPornhub();
    return {
      total: visible.length,
      page,
      perPage,
      hasMore: visible.length > page * perPage,
      items: pageScenes.map((scene) => {
        const status = allStatuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          scene,
          integrationType,
          status,
          isSceneStatusRequestable(status),
          streaming,
        );
      }),
    };
  }

  // A feed with amateur-network scenes hidden (unless already in the
  // library). Provider pages are read ahead -- several in parallel -- until
  // there's a full page of visible scenes, and the read-ahead is kept per
  // feed so scrolling on continues where it left off instead of starting
  // over. Page 1 always starts fresh, so new scenes show up.
  private async getFilteredScenesFeed(
    feedKey: string,
    page: number,
    perPage: number,
    integrationType: CatalogProviderIntegrationType,
    fetchProviderPage: (
      providerPage: number,
    ) => Promise<{ total: number; scenes: StashdbScene[] }>,
  ): Promise<ScenesFeedResponseDto> {
    const now = Date.now();
    let state = this.filteredFeeds.get(feedKey);
    if (!state || page === 1 || state.expiresAt < now) {
      state = {
        scenes: [],
        seen: new Set(),
        nextProviderPage: 1,
        exhausted: false,
        providerTotal: 0,
        expiresAt: 0,
      };
    }

    const needed = page * perPage + 1;
    let fetchedPages = 0;
    while (
      state.scenes.length < needed &&
      !state.exhausted &&
      fetchedPages < ScenesService.FILTERED_FEED_MAX_PAGES_PER_REQUEST
    ) {
      const batchSize = Math.min(
        ScenesService.FILTERED_FEED_PARALLEL_PAGES,
        ScenesService.FILTERED_FEED_MAX_PAGES_PER_REQUEST - fetchedPages,
      );
      const providerPages = Array.from(
        { length: batchSize },
        (_, index) => state!.nextProviderPage + index,
      );
      const results = await Promise.all(
        providerPages.map((providerPage) => fetchProviderPage(providerPage)),
      );
      fetchedPages += batchSize;
      state.nextProviderPage += batchSize;

      const batchScenes = results.flatMap((result) => result.scenes);
      const statuses = await this.sceneStatusService.resolveForScenes(
        batchScenes.map((scene) => scene.id),
      );
      results.forEach((result, index) => {
        state!.providerTotal = result.total;
        const pageNumber = providerPages[index];
        if (
          result.scenes.length === 0 ||
          pageNumber * perPage >= result.total
        ) {
          state!.exhausted = true;
        }
      });
      for (const scene of filterExcludedNetworkScenes(
        batchScenes,
        statuses,
        true,
      )) {
        // Pages can shift as new scenes arrive upstream: skip repeats.
        if (!state.seen.has(scene.id)) {
          state.seen.add(scene.id);
          state.scenes.push(scene);
        }
      }
    }

    state.expiresAt = now + ScenesService.FILTERED_FEED_TTL_MS;
    if (this.filteredFeeds.size >= ScenesService.FILTERED_FEED_CACHE_LIMIT) {
      this.filteredFeeds.clear();
    }
    this.filteredFeeds.set(feedKey, state);

    const pageScenes = state.scenes.slice((page - 1) * perPage, page * perPage);
    // Statuses fresh for what's shown (a scene may have been requested since).
    const statuses = await this.sceneStatusService.resolveForScenes(
      pageScenes.map((scene) => scene.id),
    );
    const streaming = await this.streamsFromPornhub();
    return {
      // Unknown until the end is reached: the provider's count is an upper bound.
      total: state.exhausted
        ? state.scenes.length
        : Math.max(state.providerTotal, state.scenes.length),
      page,
      perPage,
      hasMore: state.scenes.length > page * perPage || !state.exhausted,
      items: pageScenes.map((scene) => {
        const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          scene,
          integrationType,
          status,
          isSceneStatusRequestable(status),
          streaming,
        );
      }),
    };
  }

  // Favorites live entirely in our own DB and a favorited list is expected
  // to be small (a curated shortlist, not the full catalog), so rather than
  // ask the provider for a "favorite performers" page it can't produce
  // (TPDB has no such filter at all), fetch each favorited performer's own
  // scenes directly and merge/sort/paginate locally. Bounded by favorited
  // performer count x a per-performer cap, not total catalog size.
  private async getFavoritePerformerScenesFeed(
    page: number,
    perPage: number,
    sort: SceneFeedSort,
    direction: SortDirection,
    studioIds: string[],
    titleQuery: string | undefined,
    tagFilter: { tagIds: string[]; mode: SceneTagMatchMode },
  ): Promise<ScenesFeedResponseDto> {
    const favoriteIds =
      await this.performerFavoritesService.listAllFavoriteIds();
    if (favoriteIds.length === 0) {
      return { total: 0, page, perPage, hasMore: false, items: [] };
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const appSettings = await this.appSettingsService.get();

    const perPerformerScenes = await Promise.all(
      favoriteIds.map(async (performerId): Promise<StashdbScene[]> => {
        try {
          const result = await catalogAdapter.getScenesForPerformer({
            baseUrl: catalogProvider.baseUrl,
            apiKey: catalogProvider.apiKey,
            performerId,
            page: 1,
            perPage: ScenesService.FAVORITE_PERFORMER_SCENES_PER_PERFORMER_CAP,
            sort: 'DATE',
            direction: 'DESC',
            // Selected tags narrow each performer's scenes (the provider
            // filters; scene lists don't carry tags to filter here).
            ...(tagFilter.tagIds.length > 0
              ? { tagIds: tagFilter.tagIds, tagMode: tagFilter.mode }
              : {}),
          });
          return result.scenes;
        } catch {
          // Deleted/merged upstream, or this performer has no scenes --
          // drop it rather than fail the whole feed.
          return [];
        }
      }),
    );

    const dedupedScenes = new Map<string, StashdbScene>();
    for (const scene of perPerformerScenes.flat()) {
      if (!dedupedScenes.has(scene.id)) {
        dedupedScenes.set(scene.id, scene);
      }
    }
    let scenes = Array.from(dedupedScenes.values());

    if (studioIds.length > 0) {
      const studioIdSet = new Set(studioIds);
      scenes = scenes.filter(
        (scene) => scene.studioId !== null && studioIdSet.has(scene.studioId),
      );
    }

    const normalizedTitleQuery = titleQuery?.trim().toLowerCase();
    if (normalizedTitleQuery) {
      scenes = scenes.filter((scene) =>
        scene.title.toLowerCase().includes(normalizedTitleQuery),
      );
    }

    const sorted = this.sortScenesLocally(scenes, sort, direction);
    const statuses = await this.sceneStatusService.resolveForScenes(
      sorted.map((scene) => scene.id),
    );
    const visibleScenes = filterExcludedNetworkScenes(
      sorted,
      statuses,
      appSettings.hideAmateurNetworkResults,
    );

    const total = visibleScenes.length;
    const start = (page - 1) * perPage;
    const pageItems = visibleScenes.slice(start, start + perPage);

    const streaming = await this.streamsFromPornhub();
    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: pageItems.map((scene) => {
        const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          scene,
          catalogProvider.integrationType,
          status,
          isSceneStatusRequestable(status),
          streaming,
        );
      }),
    };
  }

  private sortScenesLocally(
    scenes: StashdbScene[],
    sort: SceneFeedSort,
    direction: SortDirection,
  ): StashdbScene[] {
    const directionFactor = direction === 'DESC' ? -1 : 1;

    return [...scenes].sort((a, b) => {
      if (sort === 'TITLE') {
        return a.title.localeCompare(b.title) * directionFactor;
      }

      // TRENDING/CREATED_AT/UPDATED_AT all collapse to date here, matching
      // TPDB's own live behavior (its list endpoints only ever honor
      // sort=date server-side too -- see tpdb.adapter.ts).
      const aDate = a.releaseDate ?? a.date;
      const bDate = b.releaseDate ?? b.date;
      if (!aDate && !bDate) {
        return 0;
      }
      if (!aDate) {
        return 1;
      }
      if (!bDate) {
        return -1;
      }
      return aDate.localeCompare(bDate) * directionFactor;
    });
  }

  async searchSceneTags(query?: string): Promise<SceneTagOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    return catalogAdapter.searchTags({
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
      query: normalizedQuery,
    });
  }

  async getSceneById(stashId: string): Promise<SceneDetailsDto> {
    const sceneId = stashId.trim();
    if (!sceneId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    const scene = await catalogAdapter.getSceneById(sceneId, {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    });
    const status = await this.sceneStatusService.resolveForScene(scene.id);
    const stash = await this.resolveStashAvailability(
      scene.id,
      catalogProvider.providerKey,
    );
    const whisparr = await this.resolveWhisparrAvailability(scene.id);
    // A scene credit only carries a single imageUrl (no full images[] list
    // to validate against, unlike getPerformerById) -- trusted as-is, same
    // tradeoff as the performers feed.
    const mainImageOverrides =
      await this.performerImagePreferenceService.getMainImageUrls(
        scene.performers.map((performer) => performer.id),
      );
    // Favorites are kept locally (TPDB never reports them on scene credits),
    // so a credit counts as a favorite if either source says so.
    const localFavoriteIds =
      await this.performerFavoritesService.getFavoriteIds(
        scene.performers.map((performer) => performer.id),
      );
    const studioFavoritedLocally = scene.studioId
      ? (
          await this.studioFavoritesService.getFavoriteIds([scene.studioId])
        ).has(scene.studioId)
      : false;

    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      images: scene.images,
      studioId: scene.studioId,
      studioIsFavorite: scene.studioIsFavorite || studioFavoritedLocally,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      studioUrl: this.resolveStudioUrl(scene.sourceUrls),
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      tags: scene.tags,
      performers: scene.performers.map((performer) => {
        const imageUrl =
          mainImageOverrides.get(performer.id) ?? performer.imageUrl;
        return {
          ...performer,
          isFavorite:
            performer.isFavorite || localFavoriteIds.has(performer.id),
          imageUrl,
          cardImageUrl: withStashImageSize(imageUrl, 300),
        };
      }),
      sourceUrls: scene.sourceUrls,
      streamEmbedUrl: (await this.appSettingsService.get()).streamFromPornhub
        ? pornhubEmbedUrl(scene.sourceUrls)
        : null,
      source: catalogProvider.integrationType,
      status,
      stash,
      whisparr,
    };
  }

  // "Similar" is defined narrowly as: already in the local library, and
  // shares at least one performer with this scene. There's no provider
  // "similar scenes" endpoint to lean on (same situation as favorited
  // performers -- see getFavoritePerformerScenesFeed above), so this
  // fetches each cast member's own recent scenes, dedupes, and keeps only
  // the ones already resolved as AVAILABLE. Only female cast members are
  // used to seed the search -- a scene's male/other performers tend to
  // recur across a much wider, less genre-consistent swath of the
  // catalog, so keying off them made results feel unrelated.
  async getSimilarScenes(
    stashId: string,
    limit = ScenesService.SIMILAR_SCENES_DEFAULT_LIMIT,
  ): Promise<SimilarScenesResponseDto> {
    const scene = await this.getSceneById(stashId);
    const performerIds = scene.performers
      .filter((performer) => performer.gender === 'FEMALE')
      .map((performer) => performer.id);
    if (performerIds.length === 0) {
      return { items: [] };
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    const perPerformerScenes = await Promise.all(
      performerIds.map(async (performerId): Promise<StashdbScene[]> => {
        try {
          const result = await catalogAdapter.getScenesForPerformer({
            baseUrl: catalogProvider.baseUrl,
            apiKey: catalogProvider.apiKey,
            performerId,
            page: 1,
            perPage: ScenesService.SIMILAR_SCENES_PER_PERFORMER_CAP,
            sort: 'DATE',
            direction: 'DESC',
          });
          return result.scenes;
        } catch {
          // Deleted/merged upstream, or this performer has no scenes --
          // drop it rather than fail the whole rail.
          return [];
        }
      }),
    );

    const dedupedScenes = new Map<string, StashdbScene>();
    for (const candidate of perPerformerScenes.flat()) {
      if (candidate.id !== scene.id && !dedupedScenes.has(candidate.id)) {
        dedupedScenes.set(candidate.id, candidate);
      }
    }

    const candidates = [...dedupedScenes.values()];
    const statuses = await this.sceneStatusService.resolveForScenes(
      candidates.map((candidate) => candidate.id),
    );
    const libraryScenes = candidates.filter(
      (candidate) => statuses.get(candidate.id)?.state === 'AVAILABLE',
    );

    const sorted = this.sortScenesLocally(libraryScenes, 'DATE', 'DESC');

    const streaming = await this.streamsFromPornhub();
    return {
      items: sorted.slice(0, limit).map((candidate) => {
        const status = statuses.get(candidate.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          candidate,
          catalogProvider.integrationType,
          status,
          isSceneStatusRequestable(status),
          streaming,
        );
      }),
    };
  }

  async getSceneStreamUrl(
    stashId: string,
    copyId?: string,
  ): Promise<{
    streamUrl: string;
    stashSceneId: string;
    resumeSeconds: number;
    duration: number | null;
  }> {
    const copy = await this.resolveStashCopy(stashId, copyId);

    return {
      streamUrl: `/api/media/stash/scenes/${encodeURIComponent(copy.id)}/stream`,
      stashSceneId: copy.id,
      resumeSeconds: copy.resumeSeconds,
      duration: copy.duration,
    };
  }

  private async resolveStashCopy(
    stashId: string,
    copyId?: string,
  ): Promise<{ id: string; resumeSeconds: number; duration: number | null }> {
    const sceneId = stashId.trim();
    if (!sceneId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    // Throws if no catalog provider is configured for this instance at all
    // — unrelated to the id-matching change below, just a normal setup
    // precondition for playback.
    await this.catalogProviderService.getConfiguredCatalogProvider();
    const integration = await this.integrationsService.findOne(
      IntegrationType.STASH,
    );

    if (
      !integration.enabled ||
      integration.status !== IntegrationStatus.CONFIGURED
    ) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    const config = { baseUrl, apiKey: integration.apiKey };
    // No providerKey overlay here on purpose: a scene tagged in Stash under
    // a previously-configured catalog provider is still genuinely playable,
    // not just copies tagged under whichever provider happens to be active
    // right now.
    const copies = await this.stashAdapter.findScenesByStashId(sceneId, config);

    const normalizedCopyId = copyId?.trim();
    const targetCopy = normalizedCopyId
      ? copies.find((copy) => copy.id === normalizedCopyId)
      : copies[0];

    if (!targetCopy) {
      throw new NotFoundException('No linked Stash scene found for playback.');
    }

    return targetCopy;
  }

  async favoriteStudio(
    studioId: string,
    favorite: boolean,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    const normalizedStudioId = studioId.trim();
    if (!normalizedStudioId) {
      throw new BadRequestException('Studio id is required.');
    }

    const result = await this.studioFavoritesService.setFavorite(
      normalizedStudioId,
      favorite,
    );

    // Best-effort only: Peeparr's own list is what counts (TPDB can't keep
    // studio favorites), so the provider never blocks the toggle.
    try {
      const catalogProvider =
        await this.catalogProviderService.getConfiguredCatalogProvider();
      const catalogAdapter =
        await this.catalogProviderService.getConfiguredCatalogAdapter();
      await catalogAdapter.favoriteStudio(normalizedStudioId, favorite, {
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
      });
    } catch {
      // ignore
    }

    return result;
  }

  private async resolveStashAvailability(
    stashId: string,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): Promise<SceneStashAvailabilityDto | null> {
    try {
      if (!activeCatalogProviderKey) {
        return null;
      }

      const integration = await this.integrationsService.findOne(
        IntegrationType.STASH,
      );

      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      // No providerKey overlay here on purpose: a scene tagged in Stash
      // under a previously-configured catalog provider is still genuinely
      // in the library, not just copies tagged under whichever provider
      // happens to be active right now.
      const copies = await this.stashAdapter.findScenesByStashId(stashId, {
        baseUrl,
        apiKey: integration.apiKey,
      });

      return {
        exists: copies.length > 0,
        hasMultipleCopies: copies.length > 1,
        copies,
      };
    } catch {
      return null;
    }
  }

  private toScenesFeedItem(
    scene: {
      id: string;
      title: string;
      details: string | null;
      imageUrl: string | null;
      studioId: string | null;
      studioName: string | null;
      studioImageUrl: string | null;
      releaseDate: string | null;
      productionDate: string | null;
      date: string | null;
      duration: number | null;
      url?: string | null;
    },
    source: CatalogProviderKey,
    status: SceneStatusDto,
    requestable: boolean,
    streaming: boolean,
  ) {
    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      cardImageUrl: withStashImageSize(scene.imageUrl, 600),
      studioId: scene.studioId,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate ?? scene.productionDate ?? scene.date,
      duration: scene.duration,
      type: 'SCENE' as const,
      source,
      status,
      requestable,
      // A Pornhub video not in the library: played streamed (Settings).
      streamable:
        streaming &&
        status.state !== 'AVAILABLE' &&
        !!scene.url &&
        pornhubEmbedUrl([{ url: scene.url }]) !== null,
    };
  }

  /** Whether scenes that are Pornhub videos play streamed (Settings). */
  private async streamsFromPornhub(): Promise<boolean> {
    return (await this.appSettingsService.get()).streamFromPornhub;
  }

  private normalizeTagIds(tagIds: string[]): string[] {
    return [...new Set(tagIds.map((tagId) => tagId.trim()).filter(Boolean))];
  }

  private normalizeStudioIds(studioIds: string[]): string[] {
    return [
      ...new Set(studioIds.map((studioId) => studioId.trim()).filter(Boolean)),
    ];
  }

  private resolveStudioUrl(
    sourceUrls: Array<{ url: string; type: string | null }>,
  ): string | null {
    const studioEntry = sourceUrls.find((entry) => {
      const normalizedType = entry.type?.trim().toLowerCase() ?? '';
      return normalizedType.includes('studio');
    });

    return studioEntry?.url ?? null;
  }

  private async resolveWhisparrAvailability(
    stashId: string,
  ): Promise<SceneWhisparrAvailabilityDto | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.WHISPARR,
      );

      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      const movie = await this.whisparrAdapter.findMovieByStashId(stashId, {
        baseUrl,
        apiKey: integration.apiKey,
      });

      if (!movie) {
        return null;
      }

      return {
        exists: true,
        viewUrl: this.whisparrAdapter.buildSceneViewUrl(baseUrl, movie.movieId),
      };
    } catch {
      return null;
    }
  }
}
