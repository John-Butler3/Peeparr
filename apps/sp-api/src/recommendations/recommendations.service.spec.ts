import { NotFoundException } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { LibrarySceneQueryService } from '../library/library-scene-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { RecommendationsService } from './recommendations.service';

const female = { gender: 'FEMALE' };
const male = { gender: 'MALE' };

describe('RecommendationsService', () => {
  const findUnique = jest.fn();
  const graphql = jest.fn();
  const getScenesByIds = jest.fn();
  let service: RecommendationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecommendationsService(
      { librarySceneIndex: { findUnique } } as unknown as PrismaService,
      {
        findOne: jest.fn().mockResolvedValue({
          enabled: true,
          status: IntegrationStatus.CONFIGURED,
          baseUrl: 'http://stash.local',
          apiKey: null,
        }),
      } as unknown as IntegrationsService,
      { graphql } as unknown as StashAdapter,
      { getScenesByIds } as unknown as LibrarySceneQueryService,
    );
    getScenesByIds.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id })));
  });

  it('puts shared-performer scenes first and keeps only all-female, other scenes', async () => {
    findUnique.mockResolvedValue({ stashSceneId: '1', performerIds: ['p1'] });
    graphql.mockImplementation(async (_config, _query, variables) =>
      variables.sceneFilter.performers
        ? {
            findScenes: {
              scenes: [
                { id: '1', performers: [female] }, // the current scene
                { id: '2', performers: [female, female] },
                { id: '3', performers: [female, male] },
              ],
            },
          }
        : {
            findScenes: {
              scenes: [
                { id: '4', performers: [female] },
                { id: '2', performers: [female, female] }, // duplicate
                { id: '5', performers: [female, { gender: null }] }, // unknown gender
                { id: '6', performers: [] },
              ],
            },
          },
    );

    const result = await service.getRecommended('1');

    expect(result.items.map((item) => item.id)).toEqual(['2', '4']);
    expect(graphql).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        filter: expect.objectContaining({ sort: 'random' }),
        sceneFilter: { performers: { value: ['p1'], modifier: 'INCLUDES' } },
      }),
    );
  });

  it('only runs the general query for a scene without performers, and honours the limit', async () => {
    findUnique.mockResolvedValue({ stashSceneId: '1', performerIds: [] });
    graphql.mockResolvedValue({
      findScenes: { scenes: ['7', '8', '9'].map((id) => ({ id, performers: [female] })) },
    });

    const result = await service.getRecommended('1', 2);

    expect(graphql).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.id)).toEqual(['7', '8']);
  });

  it('reports a scene missing from the library as not found', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.getRecommended('404')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('for a scene not in the library', () => {
    const scene = (id: string, genders: string[]) => ({
      id,
      performers: genders.map((gender) => ({ gender })),
    });

    it('finds library scenes with its performers by catalog id, most shared first, all-female only', async () => {
      graphql.mockImplementation(async (_config, _query, variables) => {
        const stashId = variables.sceneFilter.performers_filter.stash_id_endpoint.stash_id;
        return {
          findScenes: {
            scenes:
              stashId === 'cat-a'
                ? [scene('20', ['FEMALE']), scene('21', ['FEMALE', 'FEMALE']), scene('22', ['FEMALE', 'MALE'])]
                : [scene('21', ['FEMALE', 'FEMALE'])],
          },
        };
      });

      const result = await service.getRecommendedForPerformers(['cat-a', 'cat-b', 'cat-a', ' ']);

      expect(graphql).toHaveBeenCalledTimes(2);
      expect(graphql).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.objectContaining({
          sceneFilter: {
            performers_filter: { stash_id_endpoint: { stash_id: 'cat-b', modifier: 'EQUALS' } },
          },
        }),
      );
      // 21 has both performers; 22 has a male performer.
      expect(getScenesByIds).toHaveBeenCalledWith(['21', '20']);
      expect(result.items.map((item) => item.id)).toEqual(['21', '20']);
    });

    it('returns nothing without asking Stash when there are no performers', async () => {
      await expect(service.getRecommendedForPerformers([])).resolves.toEqual({ items: [] });
      expect(graphql).not.toHaveBeenCalled();
    });
  });
});
