import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LibrarySearchDto,
  LibrarySearchPerformerDto,
  LibrarySearchScenesDto,
  LibrarySearchStudioDto,
  LibrarySearchTagDto,
} from './dto/library-search.dto';
import { LibrarySceneQueryService } from './library-scene-query.service';

// Grouped search over the local library index: scenes matching the query by
// title, studio, performer name or tag name, plus the matching performers,
// studios and tags themselves (with how many library scenes each has).
@Injectable()
export class LibrarySearchService {
  static readonly DEFAULT_SCENES_PER_PAGE = 6;
  private static readonly PERFORMER_LIMIT = 12;
  private static readonly STUDIO_LIMIT = 12;
  private static readonly TAG_LIMIT = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly librarySceneQueryService: LibrarySceneQueryService,
  ) {}

  async search(
    query: string,
    perPage = LibrarySearchService.DEFAULT_SCENES_PER_PAGE,
  ): Promise<LibrarySearchDto> {
    const normalizedQuery = query.trim();
    const [scenes, performers, studios, tags] = await Promise.all([
      this.searchScenes(normalizedQuery, 1, perPage),
      this.searchPerformers(normalizedQuery),
      this.searchStudios(normalizedQuery),
      this.searchTags(normalizedQuery),
    ]);

    return { query: normalizedQuery, scenes, performers, studios, tags };
  }

  async searchScenes(
    query: string,
    page = 1,
    perPage = LibrarySearchService.DEFAULT_SCENES_PER_PAGE,
  ): Promise<LibrarySearchScenesDto> {
    const pattern = this.toLikePattern(query);
    // Same trigram-indexed expressions as the tag option search
    // (library_scene_tag_names_search_text flattens a text[] to one string).
    const matchSql = Prisma.sql`
      "title" ILIKE ${pattern}
      OR "studioName" ILIKE ${pattern}
      OR library_scene_tag_names_search_text("performerNames") ILIKE ${pattern}
      OR library_scene_tag_names_search_text("tagNames") ILIKE ${pattern}
    `;

    const [idRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ stashSceneId: string }>>(Prisma.sql`
        SELECT "stashSceneId"
        FROM "LibrarySceneIndex"
        WHERE ${matchSql}
        ORDER BY ("title" ILIKE ${pattern}) DESC,
          "releaseDate" DESC NULLS LAST,
          "title" ASC,
          "stashSceneId" ASC
        LIMIT ${perPage}
        OFFSET ${(page - 1) * perPage}
      `),
      this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM "LibrarySceneIndex"
        WHERE ${matchSql}
      `),
    ]);
    const total = countRows[0]?.total ?? 0;
    const items = await this.librarySceneQueryService.getScenesByIds(
      idRows.map((row) => row.stashSceneId),
    );

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items,
    };
  }

  private async searchPerformers(
    query: string,
  ): Promise<LibrarySearchPerformerDto[]> {
    const pattern = this.toLikePattern(query);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; sceneCount: number }>
    >(Prisma.sql`
      SELECT performer.performer_id AS id,
        MIN(performer.performer_name) AS name,
        COUNT(*)::int AS "sceneCount"
      FROM "LibrarySceneIndex"
      CROSS JOIN LATERAL unnest("performerIds", "performerNames")
        AS performer(performer_id, performer_name)
      WHERE library_scene_tag_names_search_text("performerNames") ILIKE ${pattern}
        AND performer.performer_name ILIKE ${pattern}
        AND performer.performer_id IS NOT NULL
      GROUP BY performer.performer_id
      ORDER BY "sceneCount" DESC, name ASC
      LIMIT ${LibrarySearchService.PERFORMER_LIMIT}
    `);

    return rows.map((row) => ({
      ...row,
      imageUrl: `/api/media/stash/performers/${encodeURIComponent(row.id)}/photo`,
    }));
  }

  private async searchStudios(query: string): Promise<LibrarySearchStudioDto[]> {
    const pattern = this.toLikePattern(query);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; hasLogo: boolean; sceneCount: number }>
    >(Prisma.sql`
      SELECT "studioId" AS id,
        MIN("studioName") AS name,
        bool_or("studioImageUrl" IS NOT NULL) AS "hasLogo",
        COUNT(*)::int AS "sceneCount"
      FROM "LibrarySceneIndex"
      WHERE "studioId" IS NOT NULL
        AND "studioName" ILIKE ${pattern}
      GROUP BY "studioId"
      ORDER BY "sceneCount" DESC, name ASC
      LIMIT ${LibrarySearchService.STUDIO_LIMIT}
    `);

    return rows.map(({ hasLogo, ...row }) => ({
      ...row,
      imageUrl: hasLogo
        ? `/api/media/stash/studios/${encodeURIComponent(row.id)}/logo`
        : null,
    }));
  }

  private searchTags(query: string): Promise<LibrarySearchTagDto[]> {
    const pattern = this.toLikePattern(query);
    return this.prisma.$queryRaw<LibrarySearchTagDto[]>(Prisma.sql`
      SELECT tag.tag_id AS id,
        MIN(tag.tag_name) AS name,
        COUNT(*)::int AS "sceneCount"
      FROM "LibrarySceneIndex"
      CROSS JOIN LATERAL unnest("tagIds", "tagNames") AS tag(tag_id, tag_name)
      WHERE library_scene_tag_names_search_text("tagNames") ILIKE ${pattern}
        AND tag.tag_name ILIKE ${pattern}
        AND tag.tag_id IS NOT NULL
      GROUP BY tag.tag_id
      ORDER BY "sceneCount" DESC, name ASC
      LIMIT ${LibrarySearchService.TAG_LIMIT}
    `);
  }

  // Substring match, with the user's text taken literally: LIKE's own
  // wildcards (and the escape character) are escaped first.
  private toLikePattern(query: string): string {
    return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  }
}
