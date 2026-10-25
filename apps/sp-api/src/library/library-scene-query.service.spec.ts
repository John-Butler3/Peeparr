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

  it('asks nothing without tags', async () => {
    const queryRaw = jest.fn();
    const service = new LibrarySceneQueryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
    await expect(service.getSimilarByTags(['  '], [])).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
