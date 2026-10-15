import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LibrarySceneDetailDto,
  LibrarySceneFeedItemDto,
  LibraryScenesFeedDto,
} from './dto/library-scenes-feed.dto';
import {
  LibrarySceneSort,
  LibrarySortDirection,
  LibraryTagMatchMode,
} from './dto/library-scenes-query.dto';
import { stashScreenshotUrl } from '../providers/stash/stash-screenshot-url.util';

const librarySceneListSelect =
  Prisma.validator<Prisma.LibrarySceneIndexSelect>()({
    stashSceneId: true,
    linkedStashId: true,
    title: true,
    description: true,
    imageUrl: true,
    studioId: true,
    studioName: true,
    studioImageUrl: true,
    performerNames: true,
    releaseDate: true,
    duration: true,
    viewUrl: true,
    localCreatedAt: true,
  });

type LibrarySceneListRow = Prisma.LibrarySceneIndexGetPayload<{
  select: typeof librarySceneListSelect;
}>;

interface LibrarySceneQueryFilters {
  sort?: LibrarySceneSort;
  direction?: LibrarySortDirection;
  query?: string;
  tagIds?: string[];
  tagMode?: LibraryTagMatchMode;
  studioIds?: string[];
  performerIds?: string[];
  favoritePerformersOnly?: boolean;
  favoriteStudiosOnly?: boolean;
  favoriteTagsOnly?: boolean;
}

@Injectable()
export class LibrarySceneQueryService {
  static readonly DEFAULT_PAGE = 1;
  static readonly DEFAULT_PER_PAGE = 24;
  static readonly DEFAULT_SORT: LibrarySceneSort = 'RELEASE_DATE';
  static readonly DEFAULT_DIRECTION: LibrarySortDirection = 'DESC';
  static readonly DEFAULT_TAG_MODE: LibraryTagMatchMode = 'OR';

  constructor(private readonly prisma: PrismaService) {}

  async getScenesFeed(
    page = LibrarySceneQueryService.DEFAULT_PAGE,
    perPage = LibrarySceneQueryService.DEFAULT_PER_PAGE,
    filters: LibrarySceneQueryFilters = {},
  ): Promise<LibraryScenesFeedDto> {
    const normalizedFilters = this.normalizeFilters(filters);
    const where = this.buildWhere(normalizedFilters);
    const orderBy = this.buildOrderBy(
      normalizedFilters.sort,
      normalizedFilters.direction,
    );
    const [rows, aggregate] = await Promise.all([
      this.prisma.librarySceneIndex.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
        select: librarySceneListSelect,
      }),
      this.prisma.librarySceneIndex.aggregate({
        where,
        _count: {
          _all: true,
        },
        _max: {
          lastSyncedAt: true,
        },
      }),
    ]);
    const total = aggregate._count._all;

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      latestSyncAt: aggregate._max.lastSyncedAt,
      items: rows.map((row) => this.toSceneFeedItem(row)),
    };
  }

  async getScenesPreview(
    limit: number,
    filters: LibrarySceneQueryFilters = {},
  ): Promise<LibrarySceneFeedItemDto[]> {
    const normalizedFilters = this.normalizeFilters(filters);
    const rows = await this.prisma.librarySceneIndex.findMany({
      where: this.buildWhere(normalizedFilters),
      orderBy: this.buildOrderBy(
        normalizedFilters.sort,
        normalizedFilters.direction,
      ),
      take: limit,
      select: librarySceneListSelect,
    });

    return rows.map((row) => this.toSceneFeedItem(row));
  }

  // One indexed scene with its performers and tags, for the local scene page.
  async getSceneDetail(stashSceneId: string): Promise<LibrarySceneDetailDto | null> {
    const row = await this.prisma.librarySceneIndex.findUnique({
      where: { stashSceneId },
      select: {
        ...librarySceneListSelect,
        performerIds: true,
        tagIds: true,
        tagNames: true,
      },
    });
    if (!row) {
      return null;
    }

    // performerIds/performerNames (and tagIds/tagNames) are parallel arrays.
    return {
      ...this.toSceneFeedItem(row),
      libraryStudioId: row.studioId,
      performers: row.performerIds.map((id, index) => ({
        id,
        name: row.performerNames[index] ?? id,
        imageUrl: `/api/media/stash/performers/${encodeURIComponent(id)}/photo`,
      })),
      tags: row.tagIds.map((id, index) => ({ id, name: row.tagNames[index] ?? id })),
    };
  }

  // Loads scenes by id, returned in the order of the given ids (for callers
  // that pick and rank the ids themselves, e.g. library search).
  async getScenesByIds(ids: string[]): Promise<LibrarySceneFeedItemDto[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.prisma.librarySceneIndex.findMany({
      where: { stashSceneId: { in: ids } },
      select: librarySceneListSelect,
    });
    const rowsById = new Map(rows.map((row) => [row.stashSceneId, row]));

    return ids.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [this.toSceneFeedItem(row)] : [];
    });
  }

  private normalizeFilters(
    filters: LibrarySceneQueryFilters,
  ): Required<LibrarySceneQueryFilters> & { query: string } {
    return {
      sort: filters.sort ?? LibrarySceneQueryService.DEFAULT_SORT,
      direction:
        filters.direction ?? LibrarySceneQueryService.DEFAULT_DIRECTION,
      query: filters.query?.trim() ?? '',
      tagIds: this.normalizeIds(filters.tagIds ?? []),
      tagMode: filters.tagMode ?? LibrarySceneQueryService.DEFAULT_TAG_MODE,
      studioIds: this.normalizeIds(filters.studioIds ?? []),
      performerIds: this.normalizeIds(filters.performerIds ?? []),
      favoritePerformersOnly: filters.favoritePerformersOnly ?? false,
      favoriteStudiosOnly: filters.favoriteStudiosOnly ?? false,
      favoriteTagsOnly: filters.favoriteTagsOnly ?? false,
    };
  }

  private buildWhere(
    filters: Required<LibrarySceneQueryFilters> & { query: string },
  ): Prisma.LibrarySceneIndexWhereInput {
    const andClauses: Prisma.LibrarySceneIndexWhereInput[] = [];

    if (filters.query) {
      andClauses.push({
        OR: [
          {
            title: {
              contains: filters.query,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: filters.query,
              mode: 'insensitive',
            },
          },
          {
            studioName: {
              contains: filters.query,
              mode: 'insensitive',
            },
          },
        ],
      });
    }

    if (filters.tagIds.length > 0) {
      andClauses.push({
        tagIds:
          filters.tagMode === 'AND'
            ? {
                hasEvery: filters.tagIds,
              }
            : {
                hasSome: filters.tagIds,
              },
      });
    }

    if (filters.studioIds.length > 0) {
      andClauses.push({
        studioId: {
          in: filters.studioIds,
        },
      });
    }

    if (filters.performerIds.length > 0) {
      andClauses.push({
        performerIds: {
          hasSome: filters.performerIds,
        },
      });
    }

    if (filters.favoritePerformersOnly) {
      andClauses.push({ hasFavoritePerformer: true });
    }

    if (filters.favoriteStudiosOnly) {
      andClauses.push({ favoriteStudio: true });
    }

    if (filters.favoriteTagsOnly) {
      andClauses.push({ hasFavoriteTag: true });
    }

    return andClauses.length > 0 ? { AND: andClauses } : {};
  }

  private buildOrderBy(
    sort: LibrarySceneSort,
    direction: LibrarySortDirection,
  ): Prisma.LibrarySceneIndexOrderByWithRelationInput[] {
    const order: Prisma.SortOrder = direction === 'ASC' ? 'asc' : 'desc';

    switch (sort) {
      case 'TITLE':
        return [{ title: order }, { stashSceneId: 'asc' }];
      case 'RELEASE_DATE':
        return [
          { releaseDate: order },
          { title: 'asc' },
          { stashSceneId: 'asc' },
        ];
      case 'CREATED_AT':
        return [
          { localCreatedAt: order },
          { title: 'asc' },
          { stashSceneId: 'asc' },
        ];
      case 'UPDATED_AT':
      default:
        return [
          { localUpdatedAt: order },
          { title: 'asc' },
          { stashSceneId: 'asc' },
        ];
    }
  }

  private toSceneFeedItem(
    row: LibrarySceneListRow,
  ): LibrarySceneFeedItemDto {
    const screenshotUrl = stashScreenshotUrl(row.stashSceneId, row.imageUrl);
    const studioLogoUrl =
      row.studioId && row.studioImageUrl
        ? `/api/media/stash/studios/${encodeURIComponent(row.studioId)}/logo`
        : null;

    return {
      id: row.stashSceneId,
      activeCatalogSceneId: row.linkedStashId,
      title: row.title,
      description: row.description,
      imageUrl: screenshotUrl,
      cardImageUrl: screenshotUrl,
      // NOT row.studioId: that's Stash's own local numeric primary key, a
      // different id space than the active catalog provider's studio ids.
      // SceneCardComponent links a non-null studioId straight to
      // /studio/:studioId, which resolves via the catalog adapter -- a
      // Stash-local id there either 404s (StashDB's UUID space) or, worse,
      // silently matches an unrelated real studio (TPDB's small-integer
      // space). Only studioLogoUrl above needs the Stash id, for the
      // Stash-asset proxy route.
      studioId: null,
      studio: row.studioName,
      studioImageUrl: studioLogoUrl,
      performerNames: row.performerNames,
      releaseDate: row.releaseDate,
      duration: row.duration,
      localCreatedAt: row.localCreatedAt,
      type: 'SCENE',
      source: 'STASH',
      viewUrl: row.viewUrl,
    };
  }

  private normalizeIds(values: string[]): string[] {
    return Array.from(
      new Set(
        values.map((value) => value.trim()).filter((value) => value.length > 0),
      ),
    );
  }
}
