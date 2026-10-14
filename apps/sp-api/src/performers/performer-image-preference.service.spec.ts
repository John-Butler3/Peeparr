import { PrismaService } from '../prisma/prisma.service';
import { PerformerImagePreferenceService } from './performer-image-preference.service';

describe('PerformerImagePreferenceService', () => {
  let rows: Map<string, { performerId: string; mainImageUrl: string }>;

  const prisma = {
    performerImagePreference: {
      findUnique: jest.fn(({ where }: { where: { performerId: string } }) =>
        Promise.resolve(rows.get(where.performerId) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: { performerId: { in: string[] } } }) =>
        Promise.resolve(
          where.performerId.in
            .map((id) => rows.get(id))
            .filter((row): row is { performerId: string; mainImageUrl: string } => row !== undefined),
        ),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { performerId: string };
          create: { performerId: string; mainImageUrl: string };
        }) => {
          rows.set(where.performerId, create);
          return Promise.resolve(create);
        },
      ),
    },
  } as unknown as PrismaService;

  let service: PerformerImagePreferenceService;

  beforeEach(() => {
    rows = new Map();
    jest.clearAllMocks();
    service = new PerformerImagePreferenceService(prisma);
  });

  it('returns null when no preference has been saved', async () => {
    await expect(service.getMainImageUrl('p-1')).resolves.toBeNull();
  });

  it('saves and returns a main image preference', async () => {
    await service.setMainImage('p-1', 'http://cdn.local/p-1-main.jpg');

    await expect(service.getMainImageUrl('p-1')).resolves.toBe('http://cdn.local/p-1-main.jpg');
  });

  it('batches a lookup across multiple performers, skipping ones with no saved preference', async () => {
    await service.setMainImage('p-1', 'http://cdn.local/p-1-main.jpg');
    await service.setMainImage('p-3', 'http://cdn.local/p-3-main.jpg');

    const result = await service.getMainImageUrls(['p-1', 'p-2', 'p-3']);

    expect(result).toEqual(
      new Map([
        ['p-1', 'http://cdn.local/p-1-main.jpg'],
        ['p-3', 'http://cdn.local/p-3-main.jpg'],
      ]),
    );
  });

  it('dedupes ids and short-circuits an empty list without querying', async () => {
    await expect(service.getMainImageUrls([])).resolves.toEqual(new Map());
    expect(prisma.performerImagePreference.findMany).not.toHaveBeenCalled();

    await service.setMainImage('p-1', 'http://cdn.local/p-1-main.jpg');
    await service.getMainImageUrls(['p-1', 'p-1']);
    expect(prisma.performerImagePreference.findMany).toHaveBeenCalledWith({
      where: { performerId: { in: ['p-1'] } },
    });
  });
});
