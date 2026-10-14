import { Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { LibrarySceneFeedItemDto } from '../library/dto/library-scenes-feed.dto';
import { LibrarySceneQueryService } from '../library/library-scene-query.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  StashAdapter,
  StashAdapterBaseConfig,
} from '../providers/stash/stash.adapter';

interface CandidateScene {
  id: string;
  performers?: Array<{ gender?: string | null }>;
}

// "Up next" for a library scene: other library scenes whose performers are
// all female. Scenes sharing a performer with the current one come first,
// the rest are shuffled (Stash's random sort).
//
// The all-female check is done here rather than with a Stash NOT filter:
// on Stash 0.31 a NOT over performers_filter didn't exclude the scene it
// should have. Performers with no gender set don't count as female.
@Injectable()
export class RecommendationsService {
  static readonly DEFAULT_LIMIT = 20;
  private static readonly SHARED_PERFORMER_POOL = 40;
  private static readonly GENERAL_POOL = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly stashAdapter: StashAdapter,
    private readonly librarySceneQueryService: LibrarySceneQueryService,
  ) {}

  async getRecommended(
    sceneId: string,
    limit = RecommendationsService.DEFAULT_LIMIT,
  ): Promise<{ items: LibrarySceneFeedItemDto[] }> {
    const normalizedId = sceneId.trim();
    const current = await this.prisma.librarySceneIndex.findUnique({
      where: { stashSceneId: normalizedId },
      select: { stashSceneId: true, performerIds: true },
    });
    if (!current) {
      throw new NotFoundException(`Library scene ${sceneId} not found.`);
    }

    const config = await this.getStashConfig();
    const [sharedPerformer, general] = await Promise.all([
      current.performerIds.length > 0
        ? this.findCandidates(config, RecommendationsService.SHARED_PERFORMER_POOL, {
            performers: { value: current.performerIds, modifier: 'INCLUDES' },
          })
        : Promise.resolve([]),
      // Narrow to scenes with at least one female performer; the "all
      // female" check happens below.
      this.findCandidates(config, RecommendationsService.GENERAL_POOL, {
        performers_filter: { gender: { value: 'FEMALE', modifier: 'EQUALS' } },
      }),
    ]);

    const seen = new Set([normalizedId]);
    const ids: string[] = [];
    for (const scene of [...sharedPerformer, ...general]) {
      if (seen.has(scene.id) || !this.isAllFemale(scene)) {
        continue;
      }
      seen.add(scene.id);
      ids.push(scene.id);
    }

    // Library index projection (same shape as the library grid); scenes not
    // indexed yet are skipped.
    const items = await this.librarySceneQueryService.getScenesByIds(ids);
    return { items: items.slice(0, limit) };
  }

  private isAllFemale(scene: CandidateScene): boolean {
    const performers = scene.performers ?? [];
    return performers.length > 0 && performers.every((performer) => performer.gender === 'FEMALE');
  }

  private async findCandidates(
    config: StashAdapterBaseConfig,
    perPage: number,
    sceneFilter: Record<string, unknown>,
  ): Promise<CandidateScene[]> {
    const data = await this.stashAdapter.graphql<{
      findScenes?: { scenes?: CandidateScene[] };
    }>(
      config,
      `
        query FindRecommendationCandidates($filter: FindFilterType, $sceneFilter: SceneFilterType) {
          findScenes(filter: $filter, scene_filter: $sceneFilter) {
            scenes {
              id
              performers {
                gender
              }
            }
          }
        }
      `,
      { filter: { page: 1, per_page: perPage, sort: 'random' }, sceneFilter },
    );

    return data?.findScenes?.scenes ?? [];
  }

  private async getStashConfig(): Promise<StashAdapterBaseConfig> {
    const integration = await this.integrationsService.findOne(IntegrationType.STASH);
    const baseUrl = integration.baseUrl?.trim();
    if (
      !integration.enabled ||
      integration.status !== IntegrationStatus.CONFIGURED ||
      !baseUrl
    ) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    return { baseUrl, apiKey: integration.apiKey };
  }
}
