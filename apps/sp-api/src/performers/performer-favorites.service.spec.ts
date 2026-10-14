import { PrismaService } from '../prisma/prisma.service';
import { PerformerFavoritesService } from './performer-favorites.service';

describe('PerformerFavoritesService', () => {
  let rows: Map<string, { id: string; performerId: string; createdAt: Date }>;
  let nextId: number;

  const prisma = {
    favoritePerformer: {
      findUnique: jest.fn(
        async ({ where }: { where: { performerId: string } }) =>
          rows.get(where.performerId) ?? null,
      ),
      findMany: jest.fn(
        async (args?: { where?: { performerId?: { in: string[] } } }) => {
          const all = Array.from(rows.values());
          const ids = args?.where?.performerId?.in;
          return ids ? all.filter((row) => ids.includes(row.performerId)) : all;
        },
      ),
      create: jest.fn(async ({ data }: { data: { performerId: string } }) => {
        const row = {
          id: `row-${nextId++}`,
          performerId: data.performerId,
          createdAt: new Date('2026-09-15T00:00:00.000Z'),
        };
        rows.set(data.performerId, row);
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { performerId: string } }) => {
        const row = rows.get(where.performerId);
        rows.delete(where.performerId);
        return row;
      }),
    },
  } as unknown as PrismaService;

  let service: PerformerFavoritesService;

  beforeEach(() => {
    rows = new Map();
    nextId = 1;
    jest.clearAllMocks();
    service = new PerformerFavoritesService(prisma);
  });

  it('reports a performer as not favorited until it is set', async () => {
    await expect(service.isFavorite('p-1')).resolves.toBe(false);
  });

  it('favorites and unfavorites a performer', async () => {
    await expect(service.setFavorite('p-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });
    await expect(service.isFavorite('p-1')).resolves.toBe(true);

    await expect(service.setFavorite('p-1', false)).resolves.toEqual({
      favorited: false,
      alreadyFavorited: true,
    });
    await expect(service.isFavorite('p-1')).resolves.toBe(false);
  });

  it('reports alreadyFavorited when favoriting twice', async () => {
    await service.setFavorite('p-1', true);

    await expect(service.setFavorite('p-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: true,
    });
  });

  it('returns only the ids that are favorited, from a bulk lookup', async () => {
    await service.setFavorite('p-1', true);
    await service.setFavorite('p-2', true);

    await expect(service.getFavoriteIds(['p-1', 'p-2', 'p-3'])).resolves.toEqual(
      new Set(['p-1', 'p-2']),
    );
  });

  it('returns an empty set without querying when given no ids', async () => {
    await expect(service.getFavoriteIds([])).resolves.toEqual(new Set());
    expect(prisma.favoritePerformer.findMany).not.toHaveBeenCalled();
  });

  it('lists every favorited performer id', async () => {
    await service.setFavorite('p-1', true);
    await service.setFavorite('p-2', true);

    await expect(service.listAllFavoriteIds()).resolves.toEqual(
      expect.arrayContaining(['p-1', 'p-2']),
    );
  });
});
