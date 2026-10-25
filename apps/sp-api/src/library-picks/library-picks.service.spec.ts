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
});
