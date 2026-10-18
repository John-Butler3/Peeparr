import { BadRequestException, Injectable } from '@nestjs/common';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbSortDirection } from '../providers/stashdb/stashdb.adapter';
import { StudioDetailsDto } from './dto/studio-details.dto';
import { StudioFeedResponseDto } from './dto/studio-feed-response.dto';
import { StudioSort } from './dto/studios-query.dto';
import { StudioFavoritesService } from './studio-favorites.service';

import { TpdbWebService } from '../tpdb-web/tpdb-web.service';
@Injectable()
export class StudiosService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;
  private static readonly DEFAULT_SORT: StudioSort = 'NAME';
  private static readonly DEFAULT_DIRECTION: StashdbSortDirection = 'ASC';

  constructor(
    private readonly catalogProviderService: CatalogProviderService,
    private readonly studioFavoritesService: StudioFavoritesService,
    private readonly tpdbWebService: TpdbWebService,
  ) {}

  /**
   * ThePornDB website's popular sites (read with the website login, like its
   * popular scenes), in its order; none without it, or with another catalog.
   */
  async getPopularStudios(): Promise<StudioFeedResponseDto> {
    const empty = { total: 0, page: 1, perPage: 0, hasMore: false, items: [] };
    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    if (catalogProvider.integrationType !== 'TPDB') {
      return empty;
    }
    const sites = await this.tpdbWebService.getPopularSites({
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    });
    if (sites.length === 0) {
      return empty;
    }
    const favoriteIds = await this.studioFavoritesService.getFavoriteIds(
      sites.map((site) => site.id),
    );
    return {
      total: sites.length,
      page: 1,
      perPage: sites.length,
      hasMore: false,
      items: sites.map((site) => ({
        id: site.id,
        name: site.name,
        isFavorite: site.isFavorite || favoriteIds.has(site.id),
        imageUrl: site.imageUrl,
        parentStudio: site.parentStudio,
        childStudios: site.childStudios,
      })),
    };
  }

  async getStudiosFeed(
    page = StudiosService.DEFAULT_PAGE,
    perPage = StudiosService.DEFAULT_PER_PAGE,
    filters?: {
      name?: string;
      sort?: StudioSort;
      direction?: StashdbSortDirection;
      favoritesOnly?: boolean;
    },
  ): Promise<StudioFeedResponseDto> {
    if (filters?.favoritesOnly) {
      const localFavoriteIds =
        await this.studioFavoritesService.listAllFavoriteIds();
      if (localFavoriteIds.length > 0) {
        return this.getFavoritedStudiosFeed(
          localFavoriteIds,
          page,
          perPage,
          filters.name,
        );
      }
    }

    const config = await this.getActiveCatalogConfig();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    const studios = await catalogAdapter.getStudiosFeed({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page,
      perPage,
      name: filters?.name,
      sort: filters?.sort ?? StudiosService.DEFAULT_SORT,
      direction: filters?.direction ?? StudiosService.DEFAULT_DIRECTION,
      favoritesOnly: filters?.favoritesOnly === true,
    });

    const hasMore = page * perPage < studios.total;
    const favoriteIds = await this.studioFavoritesService.getFavoriteIds(
      studios.studios.map((studio) => studio.id),
    );

    return {
      total: studios.total,
      page,
      perPage,
      hasMore,
      items: studios.studios.map((studio) => ({
        id: studio.id,
        name: studio.name,
        isFavorite: studio.isFavorite || favoriteIds.has(studio.id),
        imageUrl: studio.imageUrl,
        parentStudio: studio.parentStudio,
        childStudios: studio.childStudios,
      })),
    };
  }

  // Favorites only, from Peeparr's own list: each favorited studio looked up
  // by id (TPDB can't filter by favorites), name-filtered and A-Z.
  private async getFavoritedStudiosFeed(
    favoriteIds: string[],
    page: number,
    perPage: number,
    name: string | undefined,
  ): Promise<StudioFeedResponseDto> {
    const config = await this.getActiveCatalogConfig();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const studios = (
      await Promise.all(
        favoriteIds.map((studioId) =>
          catalogAdapter.getStudioById(studioId, config).catch(() => null),
        ),
      )
    ).filter((studio): studio is NonNullable<typeof studio> => studio !== null);

    const query = name?.trim().toLowerCase();
    const matching = (
      query
        ? studios.filter((studio) => studio.name.toLowerCase().includes(query))
        : studios
    ).sort((a, b) => a.name.localeCompare(b.name));
    const start = (page - 1) * perPage;

    return {
      total: matching.length,
      page,
      perPage,
      hasMore: page * perPage < matching.length,
      items: matching.slice(start, start + perPage).map((studio) => ({
        id: studio.id,
        name: studio.name,
        isFavorite: true,
        imageUrl: studio.imageUrl,
        parentStudio: studio.parentStudio,
        childStudios: studio.childStudios,
      })),
    };
  }

  async getStudioById(studioId: string): Promise<StudioDetailsDto> {
    const normalizedStudioId = studioId.trim();
    if (!normalizedStudioId) {
      throw new BadRequestException('Studio id is required.');
    }

    const config = await this.getActiveCatalogConfig();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();
    const studio = await catalogAdapter.getStudioById(
      normalizedStudioId,
      config,
    );

    const favoritedLocally = (
      await this.studioFavoritesService.getFavoriteIds([studio.id])
    ).has(studio.id);

    return {
      id: studio.id,
      name: studio.name,
      aliases: studio.aliases,
      deleted: studio.deleted,
      isFavorite: studio.isFavorite || favoritedLocally,
      createdAt: studio.createdAt,
      updatedAt: studio.updatedAt,
      imageUrl: studio.imageUrl,
      images: studio.images,
      urls: studio.urls,
      parentStudio: studio.parentStudio,
      childStudios: studio.childStudios,
    };
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
}
