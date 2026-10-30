import { Injectable, Logger } from '@nestjs/common';
import { LibrarySceneQueryService } from '../library/library-scene-query.service';
import { LibrarySceneFeedItemDto } from '../library/dto/library-scenes-feed.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';

/**
 * Picks from the library: a random handful of scenes not played yet (no
 * plays, no resume point -- as Stash keeps them), for Up next; and any one
 * scene at random, for Home's shuffle button.
 */
@Injectable()
export class LibraryPicksService {
  private readonly logger = new Logger(LibraryPicksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stashAdapter: StashAdapter,
    private readonly librarySceneQueryService: LibrarySceneQueryService,
  ) {}

  async getRandomUnplayed(
    limit: number,
    excludeIds: string[] = [],
  ): Promise<LibrarySceneFeedItemDto[]> {
    const config = await this.getStashConfig();
    if (!config) {
      return [];
    }
    const exclude = new Set(excludeIds);
    let scenes: Array<{ id: string }>;
    try {
      // A few extra, for any left out.
      scenes = await this.stashAdapter.getRandomUnwatchedScenes(
        config,
        limit + exclude.size,
        null,
      );
    } catch (error) {
      this.logger.warn(
        `Couldn't pick unplayed scenes: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
    const ids = scenes
      .map((scene) => scene.id)
      .filter((id) => !exclude.has(id))
      .slice(0, limit);
    // As the library shows them (and only ones it has).
    return this.librarySceneQueryService.getScenesByIds(ids);
  }

  /**
   * Any scene in the library index, at random (not `excludeId`, the one
   * just shown, when there's another). Null with an empty library.
   */
  async getRandomSceneId(excludeId?: string): Promise<string | null> {
    const count = await this.prisma.librarySceneIndex.count();
    if (count === 0) {
      return null;
    }
    const pick = async (skip: number) =>
      (
        await this.prisma.librarySceneIndex.findFirst({
          orderBy: { stashSceneId: 'asc' },
          skip,
          select: { stashSceneId: true },
        })
      )?.stashSceneId ?? null;
    const skip = Math.floor(Math.random() * count);
    const id = await pick(skip);
    return id === excludeId && count > 1 ? pick((skip + 1) % count) : id;
  }

  private async getStashConfig(): Promise<{
    baseUrl: string;
    apiKey?: string | null;
  } | null> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type: 'STASH' },
    });
    const baseUrl = integration?.baseUrl?.trim();
    if (
      !integration ||
      !integration.enabled ||
      integration.status !== 'CONFIGURED' ||
      !baseUrl
    ) {
      return null;
    }
    return { baseUrl, apiKey: integration.apiKey };
  }
}
