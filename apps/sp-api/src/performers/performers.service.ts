import {
  DiscoverResponseDto,
} from '../discover/dto/discover-item.dto';
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { StashdbPerformerDetails } from '../providers/stashdb/stashdb.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { filterExcludedNetworkScenes } from '../scene-status/exclude-network-scenes.util';
import { AppSettingsService } from '../settings/app-settings.service';
import { PerformerFavoritesService } from './performer-favorites.service';
import { PerformerImagePreferenceService } from './performer-image-preference.service';
import { PerformerDetailsDto } from './dto/performer-details.dto';
import { PerformerFeedItemDto } from './dto/performer-feed-item.dto';
import { PerformerFeedResponseDto } from './dto/performer-feed-response.dto';
import {
  PerformerScenesSort,
  SortDirection as PerformerScenesSortDirection,
} from './dto/performer-scenes-query.dto';
import { PerformerStudioOptionDto } from './dto/performer-studio-option.dto';
import {
  PerformerGender,
  PerformerSort,
  SortDirection as PerformerSortDirection,
} from './dto/performers-query.dto';

@Injectable()
export class PerformersService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;
  private static readonly DEFAULT_SCENES_PER_PAGE = 24;
  private static readonly DEFAULT_PERFORMERS_SORT_DIRECTION: PerformerSortDirection = 'ASC';
  private static readonly DEFAULT_SCENES_SORT_DIRECTION: PerformerScenesSortDirection = 'DESC';

  constructor(
    private readonly catalogProviderService: CatalogProviderService,
    private readonly sceneStatusService: SceneStatusService,
    private readonly appSettingsService: AppSettingsService,
    private readonly performerFavoritesService: PerformerFavoritesService,
    private readonly performerImagePreferenceService: PerformerImagePreferenceService,
    private readonly integrationsService: IntegrationsService,
    private readonly stashAdapter: StashAdapter,
  ) {}

  async getPerformersFeed(
    page = PerformersService.DEFAULT_PAGE,
    perPage = PerformersService.DEFAULT_PER_PAGE,
    filters?: {
      name?: string;
      gender?: PerformerGender;
      sort?: PerformerSort;
      direction?: PerformerSortDirection;
      favoritesOnly?: boolean;
    },
  ): Promise<PerformerFeedResponseDto> {
    if (filters?.favoritesOnly) {
      return this.getFavoritedPerformersFeed(page, perPage, filters);
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    const performers = await catalogAdapter.getPerformersFeed({
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
      page,
      perPage,
      name: filters?.name,
      gender: filters?.gender,
      sort: filters?.sort ?? 'NAME',
      direction:
        filters?.direction ?? PerformersService.DEFAULT_PERFORMERS_SORT_DIRECTION,
      favoritesOnly: false,
    });
    const performerIds = performers.performers.map((performer) => performer.id);
    const [favoriteIds, mainImageOverrides] = await Promise.all([
      this.performerFavoritesService.getFavoriteIds(performerIds),
      this.performerImagePreferenceService.getMainImageUrls(performerIds),
    ]);

    const hasMore = page * perPage < performers.total;

    return {
      total: performers.total,
      page,
      perPage,
      hasMore,
      items: performers.performers.map((performer) => {
        // The feed only carries a single imageUrl (no full images[] list),
        // so unlike getPerformerById there's nothing to validate the saved
        // override against here -- trusted as-is.
        const imageUrl = mainImageOverrides.get(performer.id) ?? performer.imageUrl;
        return {
          id: performer.id,
          name: performer.name,
          gender: performer.gender,
          sceneCount: performer.sceneCount,
          // isFavorite is locally-tracked, not the catalog provider's own
          // flag -- see PerformerFavoritesService for why.
          isFavorite: favoriteIds.has(performer.id),
          imageUrl,
          cardImageUrl: withStashImageSize(imageUrl, 300),
        };
      }),
    };
  }

  // Favorites live entirely in our own DB, and a favorited list is expected
  // to be small (a curated shortlist, not the full catalog), so rather than
  // ask the catalog provider for a "favorites only" page it can't reliably
  // produce (TPDB has no such filter at all), fetch every favorited
  // performer's details directly and filter/sort/paginate locally.
  private async getFavoritedPerformersFeed(
    page: number,
    perPage: number,
    filters: {
      name?: string;
      gender?: PerformerGender;
      sort?: PerformerSort;
      direction?: PerformerSortDirection;
    },
  ): Promise<PerformerFeedResponseDto> {
    const favoriteIds = await this.performerFavoritesService.listAllFavoriteIds();
    if (favoriteIds.length === 0) {
      return { total: 0, page, perPage, hasMore: false, items: [] };
    }

    const config = await this.getActiveCatalogConfig();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    const performers = (
      await Promise.all(
        favoriteIds.map(async (performerId) => {
          try {
            return await catalogAdapter.getPerformerById(performerId, config);
          } catch {
            // Deleted/merged upstream since being favorited -- drop it
            // rather than fail the whole feed.
            return null;
          }
        }),
      )
    ).filter((performer): performer is StashdbPerformerDetails => performer !== null);

    const nameQuery = filters.name?.trim().toLowerCase();
    const nameFiltered = nameQuery
      ? performers.filter((performer) => performer.name.toLowerCase().includes(nameQuery))
      : performers;
    const genderFiltered = filters.gender
      ? nameFiltered.filter((performer) => performer.gender === filters.gender)
      : nameFiltered;

    const sorted = this.sortFavoritedPerformers(
      genderFiltered,
      filters.sort ?? 'NAME',
      filters.direction ?? PerformersService.DEFAULT_PERFORMERS_SORT_DIRECTION,
    );

    const total = sorted.length;
    const start = (page - 1) * perPage;
    const pageItems = sorted.slice(start, start + perPage);

    const mainImageOverrides = await this.performerImagePreferenceService.getMainImageUrls(
      pageItems.map((performer) => performer.id),
    );

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: pageItems.map((performer): PerformerFeedItemDto => {
        const savedOverride = mainImageOverrides.get(performer.id);
        const imageUrl =
          savedOverride && performer.images.some((image) => image.url === savedOverride)
            ? savedOverride
            : performer.imageUrl;
        return {
          id: performer.id,
          name: performer.name,
          gender: performer.gender,
          // Not available from a single-performer lookup without an extra
          // per-performer scene-count query; favorites-only view doesn't
          // show it as a sortable/reliable figure anyway.
          sceneCount: 0,
          isFavorite: true,
          imageUrl,
          cardImageUrl: withStashImageSize(imageUrl, 300),
        };
      }),
    };
  }

  private sortFavoritedPerformers(
    performers: StashdbPerformerDetails[],
    sort: PerformerSort,
    direction: PerformerSortDirection,
  ): StashdbPerformerDetails[] {
    // SCENE_COUNT/DEBUT/LAST_SCENE need data this lookup doesn't have
    // (see getFavoritedPerformersFeed) -- fall back to NAME rather than
    // silently no-op or throw.
    const sortKey: 'name' | 'birthDate' | 'deathDate' | 'careerStartYear' | 'createdAt' | 'updatedAt' =
      sort === 'BIRTHDATE'
        ? 'birthDate'
        : sort === 'DEATHDATE'
          ? 'deathDate'
          : sort === 'CAREER_START_YEAR'
            ? 'careerStartYear'
            : sort === 'CREATED_AT'
              ? 'createdAt'
              : sort === 'UPDATED_AT'
                ? 'updatedAt'
                : 'name';

    const directionFactor = direction === 'DESC' ? -1 : 1;

    return [...performers].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      if (aValue === null && bValue === null) {
        return 0;
      }
      if (aValue === null) {
        return 1;
      }
      if (bValue === null) {
        return -1;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * directionFactor;
      }

      return String(aValue).localeCompare(String(bValue)) * directionFactor;
    });
  }

  async getPerformerById(performerId: string): Promise<PerformerDetailsDto> {
    const normalizedPerformerId = performerId.trim();
    if (!normalizedPerformerId) {
      throw new BadRequestException('Performer id is required.');
    }

    const config = await this.getActiveCatalogConfig();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const [performer, isFavorite, savedMainImageUrl] = await Promise.all([
      catalogAdapter.getPerformerById(normalizedPerformerId, config),
      this.performerFavoritesService.isFavorite(normalizedPerformerId),
      this.performerImagePreferenceService.getMainImageUrl(normalizedPerformerId),
    ]);

    // Only honor a saved pick while it's still one of the provider's current
    // images -- if the gallery has since changed upstream, fall back rather
    // than surface a stale/broken URL as the main image.
    const imageUrl =
      savedMainImageUrl && performer.images.some((image) => image.url === savedMainImageUrl)
        ? savedMainImageUrl
        : performer.imageUrl;

    return {
      id: performer.id,
      name: performer.name,
      disambiguation: performer.disambiguation,
      aliases: performer.aliases,
      gender: performer.gender,
      birthDate: performer.birthDate,
      deathDate: performer.deathDate,
      age: performer.age,
      ethnicity: performer.ethnicity,
      country: performer.country,
      eyeColor: performer.eyeColor,
      hairColor: performer.hairColor,
      height: performer.height,
      cupSize: performer.cupSize,
      bandSize: performer.bandSize,
      waistSize: performer.waistSize,
      hipSize: performer.hipSize,
      breastType: performer.breastType,
      careerStartYear: performer.careerStartYear,
      careerEndYear: performer.careerEndYear,
      deleted: performer.deleted,
      mergedIds: performer.mergedIds,
      mergedIntoId: performer.mergedIntoId,
      // Locally-tracked, not the catalog provider's own flag -- see
      // PerformerFavoritesService.
      isFavorite,
      createdAt: performer.createdAt,
      updatedAt: performer.updatedAt,
      imageUrl,
      images: performer.images,
    };
  }

  async setMainPerformerImage(
    performerId: string,
    imageUrl: string,
  ): Promise<PerformerDetailsDto> {
    const normalizedPerformerId = performerId.trim();
    if (!normalizedPerformerId) {
      throw new BadRequestException('Performer id is required.');
    }

    const normalizedImageUrl = imageUrl.trim();
    if (!normalizedImageUrl) {
      throw new BadRequestException('Image URL is required.');
    }

    const config = await this.getActiveCatalogConfig();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const performer = await catalogAdapter.getPerformerById(normalizedPerformerId, config);

    const isKnownImage = performer.images.some((image) => image.url === normalizedImageUrl);
    if (!isKnownImage) {
      throw new BadRequestException(
        "Image URL is not one of this performer's available images.",
      );
    }

    await this.performerImagePreferenceService.setMainImage(
      normalizedPerformerId,
      normalizedImageUrl,
    );

    return this.getPerformerById(normalizedPerformerId);
  }

  async getPerformerScenes(
    performerId: string,
    page = PerformersService.DEFAULT_PAGE,
    perPage = PerformersService.DEFAULT_SCENES_PER_PAGE,
    filters?: {
      studioIds?: string[];
      tagIds?: string[];
      sort?: PerformerScenesSort;
      direction?: PerformerScenesSortDirection;
      onlyFavoriteStudios?: boolean;
    },
  ): Promise<DiscoverResponseDto> {
    const normalizedPerformerId = performerId.trim();
    if (!normalizedPerformerId) {
      throw new BadRequestException('Performer id is required.');
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const [scenes, appSettings] = await Promise.all([
      catalogAdapter.getScenesForPerformer({
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
        performerId: normalizedPerformerId,
        page,
        perPage,
        sort: filters?.sort ?? 'DATE',
        direction: filters?.direction ?? PerformersService.DEFAULT_SCENES_SORT_DIRECTION,
        studioIds: this.normalizeIds(filters?.studioIds ?? []),
        tagIds: this.normalizeIds(filters?.tagIds ?? []),
        onlyFavoriteStudios: filters?.onlyFavoriteStudios === true,
      }),
      this.appSettingsService.get(),
    ]);

    // total/hasMore still reflect the catalog provider's raw, unfiltered
    // count -- see the identical note in ScenesService.getScenesFeed.
    const hasMore = page * perPage < scenes.total;
    const statuses = await this.sceneStatusService.resolveForScenes(
      scenes.scenes.map((scene) => scene.id),
    );
    const visibleScenes = filterExcludedNetworkScenes(
      scenes.scenes,
      statuses,
      appSettings.hideAmateurNetworkResults,
    );

    return {
      total: scenes.total,
      page,
      perPage,
      hasMore,
      items: visibleScenes.map((scene) => ({
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
        type: 'SCENE',
        source: catalogProvider.integrationType,
        status: statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' },
      })),
    };
  }

  async searchStudios(query?: string): Promise<PerformerStudioOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const config = await this.getActiveCatalogConfig();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    return catalogAdapter.searchStudios(normalizedQuery, config);
  }

  async favoritePerformer(
    performerId: string,
    favorite: boolean,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    const normalizedPerformerId = performerId.trim();
    if (!normalizedPerformerId) {
      throw new BadRequestException('Performer id is required.');
    }

    const result = await this.performerFavoritesService.setFavorite(
      normalizedPerformerId,
      favorite,
    );

    // Best-effort only: our own table is the source of truth (see
    // PerformerFavoritesService), so a provider that can't persist or
    // report this back -- TPDB -- must never block the toggle.
    try {
      const catalogProvider =
        await this.catalogProviderService.getConfiguredCatalogProvider();
      const catalogAdapter =
        await this.catalogProviderService.getConfiguredCatalogAdapter();
      await catalogAdapter.favoritePerformer(normalizedPerformerId, favorite, {
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
      });
    } catch {
      // ignore
    }

    // Also best-effort: if this catalog-provider performer is already
    // matched to a performer in the local Stash library, mirror the
    // favorite there too. Library's own "Favorite Performers Only" filter
    // is driven entirely by Stash's native favorite flag (synced into
    // LibrarySceneIndex on the next indexing pass), so this is what makes
    // favoriting here actually show up in Library -- without it the two
    // "favorite" concepts would silently drift apart.
    await this.syncFavoriteToStash(normalizedPerformerId, favorite);

    return result;
  }

  private async syncFavoriteToStash(
    catalogPerformerId: string,
    favorite: boolean,
  ): Promise<void> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.STASH,
      );
      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return;
      }

      const stashConfig = { baseUrl, apiKey: integration.apiKey };
      const match = await this.stashAdapter.findPerformerByStashId(
        catalogPerformerId,
        stashConfig,
      );
      if (!match) {
        return;
      }

      await this.stashAdapter.setPerformerFavorite(
        match.id,
        favorite,
        stashConfig,
      );
    } catch {
      // Best-effort: Stash may not be configured, or this performer may
      // not be matched into the local library yet.
    }
  }

  private async getActiveCatalogConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();

    return {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    };
  }

  private normalizeIds(ids: string[]): string[] {
    return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
  }
}
