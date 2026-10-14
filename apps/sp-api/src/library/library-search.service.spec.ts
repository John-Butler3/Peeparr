import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LibrarySceneQueryService } from './library-scene-query.service';
import { LibrarySearchService } from './library-search.service';

function buildLibraryRow(id: string) {
  return {
    stashSceneId: id,
    linkedStashId: `stash-${id}`,
    title: `Scene ${id}`,
    description: null,
    imageUrl: null,
    studioId: 'studio-1',
    studioName: 'Archive',
    studioImageUrl: null,
    performerNames: ['Performer One'],
    releaseDate: '2026-03-24',
    duration: 1800,
    viewUrl: `http://stash.local/scenes/${id}`,
    localCreatedAt: null,
  };
}

// The tagged-template SQL's bound values, to assert on what was queried.
function sqlValues(call: unknown[]): unknown[] {
  return (call[0] as Prisma.Sql).values;
}

describe('LibrarySearchService', () => {
  const findManyMock = jest.fn();
  const queryRawMock = jest.fn();
  const prismaService = {
    librarySceneIndex: { findMany: findManyMock },
    $queryRaw: queryRawMock,
  } as unknown as PrismaService;

  let service: LibrarySearchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LibrarySearchService(
      prismaService,
      new LibrarySceneQueryService(prismaService),
    );
  });

  // $queryRaw calls in search(): scene ids, scene count, performers,
  // studios, tags -- answered by which table expression the SQL uses.
  function mockSearchQueries(results: {
    sceneIds?: string[];
    total?: number;
    performers?: unknown[];
    studios?: unknown[];
    tags?: unknown[];
  }) {
    queryRawMock.mockImplementation((sql: Prisma.Sql) => {
      const text = sql.sql;
      if (text.includes('COUNT(*)::int AS total')) {
        return Promise.resolve([{ total: results.total ?? 0 }]);
      }
      if (text.includes('AS performer(')) {
        return Promise.resolve(results.performers ?? []);
      }
      if (text.includes('"studioId" AS id')) {
        return Promise.resolve(results.studios ?? []);
      }
      if (text.includes('AS tag(')) {
        return Promise.resolve(results.tags ?? []);
      }
      return Promise.resolve(
        (results.sceneIds ?? []).map((stashSceneId) => ({ stashSceneId })),
      );
    });
  }

  it('returns the first scenes in ranked order plus grouped performers, studios and tags', async () => {
    mockSearchQueries({
      sceneIds: ['22', '11'],
      total: 9,
      performers: [{ id: '7', name: 'Performer One', sceneCount: 4 }],
      studios: [
        { id: 'studio-1', name: 'Archive', hasLogo: true, sceneCount: 3 },
        { id: 'studio-2', name: 'Archive Two', hasLogo: false, sceneCount: 1 },
      ],
      tags: [{ id: 'tag-1', name: 'Archived', sceneCount: 2 }],
    });
    // Prisma returns rows in its own order; the ranked id order must win.
    findManyMock.mockResolvedValue([buildLibraryRow('11'), buildLibraryRow('22')]);

    const result = await service.search('  arch ', 2);

    expect(result.query).toBe('arch');
    expect(result.scenes).toEqual(
      expect.objectContaining({ total: 9, page: 1, perPage: 2, hasMore: true }),
    );
    expect(result.scenes.items.map((item) => item.id)).toEqual(['22', '11']);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stashSceneId: { in: ['22', '11'] } } }),
    );
    expect(result.performers).toEqual([
      {
        id: '7',
        name: 'Performer One',
        sceneCount: 4,
        imageUrl: '/api/media/stash/performers/7/photo',
      },
    ]);
    expect(result.studios).toEqual([
      {
        id: 'studio-1',
        name: 'Archive',
        sceneCount: 3,
        imageUrl: '/api/media/stash/studios/studio-1/logo',
      },
      { id: 'studio-2', name: 'Archive Two', sceneCount: 1, imageUrl: null },
    ]);
    expect(result.tags).toEqual([{ id: 'tag-1', name: 'Archived', sceneCount: 2 }]);
  });

  it('pages scene results and reports when there are no more', async () => {
    mockSearchQueries({ sceneIds: ['31'], total: 7 });
    findManyMock.mockResolvedValue([buildLibraryRow('31')]);

    const result = await service.searchScenes('arch', 2, 6);

    expect(result).toEqual(
      expect.objectContaining({ total: 7, page: 2, perPage: 6, hasMore: false }),
    );
    const idQuery = queryRawMock.mock.calls.find(
      ([sql]) => !(sql as Prisma.Sql).sql.includes('COUNT(*)'),
    )!;
    // LIMIT perPage, OFFSET (page - 1) * perPage are the last two values.
    expect(sqlValues(idQuery).slice(-2)).toEqual([6, 6]);
  });

  it('matches the query literally, escaping LIKE wildcards', async () => {
    mockSearchQueries({});
    findManyMock.mockResolvedValue([]);

    await service.searchScenes('100%_off\\', 1, 6);

    expect(sqlValues(queryRawMock.mock.calls[0])).toContain('%100\\%\\_off\\\\%');
  });

  it('skips loading scene rows when nothing matches', async () => {
    mockSearchQueries({ total: 0 });

    const result = await service.searchScenes('zzz', 1, 6);

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
