import { LibrarySceneQueryService } from '../library/library-scene-query.service';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { LibraryPicksService } from './library-picks.service';

describe('LibraryPicksService', () => {
  it("picks random unplayed scenes from Stash, leaving out the one you're on", async () => {
    const prisma = {
      integrationConfig: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          status: 'CONFIGURED',
          baseUrl: 'http://stash.local',
          apiKey: 'k',
        }),
      },
    } as unknown as PrismaService;
    const getRandomUnwatchedScenes = jest
      .fn()
      .mockResolvedValue([
        { id: '7' },
        { id: '412' },
        { id: '9' },
        { id: '11' },
      ]);
    const getScenesByIds = jest.fn(async (ids: string[]) =>
      ids.map((id) => ({ id })),
    );
    const service = new LibraryPicksService(
      prisma,
      { getRandomUnwatchedScenes } as unknown as StashAdapter,
      { getScenesByIds } as unknown as LibrarySceneQueryService,
    );

    const picks = await service.getRandomUnplayed(2, ['412']);

    // One extra asked for, for the one left out.
    expect(getRandomUnwatchedScenes).toHaveBeenCalledWith(
      { baseUrl: 'http://stash.local', apiKey: 'k' },
      3,
      null,
    );
    expect(getScenesByIds).toHaveBeenCalledWith(['7', '9']);
    expect(picks.map((pick) => (pick as unknown as { id: string }).id)).toEqual(
      ['7', '9'],
    );
  });

  it('picks any library scene at random, not the one just shown', async () => {
    const ids = ['1', '2', '3'];
    const findFirst = jest.fn(async ({ skip }: { skip: number }) => ({
      stashSceneId: ids[skip],
    }));
    const prisma = {
      librarySceneIndex: { count: jest.fn().mockResolvedValue(3), findFirst },
    } as unknown as PrismaService;
    const service = new LibraryPicksService(
      prisma,
      {} as StashAdapter,
      {} as LibrarySceneQueryService,
    );
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    await expect(service.getRandomSceneId()).resolves.toBe('2');
    // The same again: the next one instead.
    await expect(service.getRandomSceneId('2')).resolves.toBe('3');
    jest.restoreAllMocks();
  });

  it('has nothing to pick from an empty library', async () => {
    const prisma = {
      librarySceneIndex: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new LibraryPicksService(
      prisma,
      {} as StashAdapter,
      {} as LibrarySceneQueryService,
    );

    await expect(service.getRandomSceneId()).resolves.toBeNull();
  });
});
