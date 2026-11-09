import { PrismaService } from '../prisma/prisma.service';
import { LibrarySceneQueryService } from './library-scene-query.service';

describe('LibrarySceneQueryService similar scenes (by tags)', () => {
  it('ranks scenes by the tags they share, a rare tag above a common one', async () => {
    const queryRaw = jest
      .fn()
      // How common each tag is: hd in nearly everything, gangbang in few.
      .mockResolvedValueOnce([
        { tag: 'anal', n: BigInt(40) },
        { tag: 'gangbang', n: BigInt(3) },
        { tag: 'hd', n: BigInt(900) },
      ])
      // The scenes sharing any of them.
      .mockResolvedValueOnce([
        { stashSceneId: 'hd-only', shared: ['hd'] },
        { stashSceneId: 'anal-hd', shared: ['anal', 'hd'] },
        { stashSceneId: 'gangbang', shared: ['gangbang'] },
        { stashSceneId: 'all-three', shared: ['anal', 'gangbang', 'hd'] },
      ]);
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    const byIds = jest
      .spyOn(service, 'getScenesByIds')
      .mockImplementation(async (ids) => ids.map((id) => ({ id }) as never));

    const similar = await service.getSimilarByTags(
      ['Anal', 'Gangbang', 'HD'],
      ['this-scene'],
      3,
    );

    expect(byIds).toHaveBeenCalledWith(['all-three', 'gangbang', 'anal-hd']);
    expect(
      similar.map((scene) => (scene as unknown as { id: string }).id),
    ).toEqual(['all-three', 'gangbang', 'anal-hd']);
  });

  it('finds linked scenes by performer name, in the order the index gives', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([{ stashSceneId: '9' }, { stashSceneId: '4' }]);
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    const byIds = jest
      .spyOn(service, 'getScenesByIds')
      .mockImplementation(async (ids) => ids.map((id) => ({ id }) as never));

    await service.getLinkedByPerformerNames([' Anna ', 'anna', 'Bella'], 12);

    expect(queryRaw.mock.calls[0]).toContainEqual(['anna', 'bella']);
    expect(queryRaw.mock.calls[0]).toContain(24);
    expect(byIds).toHaveBeenCalledWith(['9', '4']);
  });

  it('asks nothing without performer names', async () => {
    const queryRaw = jest.fn();
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    await expect(
      service.getLinkedByPerformerNames(['  '], 12),
    ).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('finds local-only scenes by Stash performer id or name, newest first', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ stashSceneId: '31' }, { stashSceneId: '7' }]);
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    const byIds = jest
      .spyOn(service, 'getScenesByIds')
      .mockImplementation((ids) =>
        Promise.resolve(ids.map((id) => ({ id }) as never)),
      );

    await service.getLocalOnlyByPerformer(
      { stashPerformerIds: [' 12 ', '12'], names: ['Anna', ' anna', 'Ann B'] },
      60,
    );

    const [sql, ...params] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(sql.join('?')).toContain('"linkedStashId" IS NULL');
    expect(params).toContainEqual(['12']);
    expect(params).toContainEqual(['anna', 'ann b']);
    expect(params).toContain(60);
    expect(byIds).toHaveBeenCalledWith(['31', '7']);
  });

  it('deals a page of the library shuffled by the seed, saying whether more follow', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ stashSceneId: '8' }, { stashSceneId: '2' }]);
    const count = jest.fn().mockResolvedValue(5);
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
      librarySceneIndex: { count },
    } as unknown as PrismaService);
    const byIds = jest
      .spyOn(service, 'getScenesByIds')
      .mockImplementation((ids) =>
        Promise.resolve(ids.map((id) => ({ id }) as never)),
      );

    const page = await service.getShuffledPage('seed-1', 2, 2);

    const [sql, ...params] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(sql.join('?')).toContain('ORDER BY md5(? || "stashSceneId")');
    expect(params).toEqual(['seed-1', 2, 2]);
    expect(byIds).toHaveBeenCalledWith(['8', '2']);
    expect(page).toMatchObject({
      total: 5,
      page: 2,
      perPage: 2,
      hasMore: true,
    });
    expect(page.items).toHaveLength(2);
  });

  it('asks nothing for a performer with neither Stash id nor name', async () => {
    const queryRaw = jest.fn();
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    await expect(
      service.getLocalOnlyByPerformer(
        { stashPerformerIds: [], names: [' '] },
        60,
      ),
    ).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('asks nothing without tags', async () => {
    const queryRaw = jest.fn();
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    await expect(service.getSimilarByTags(['  '], [])).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
