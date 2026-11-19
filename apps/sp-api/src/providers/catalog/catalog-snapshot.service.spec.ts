import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CatalogSnapshotService,
  isCatalogOutage,
} from './catalog-snapshot.service';

describe('CatalogSnapshotService', () => {
  const findUnique = jest.fn();
  const upsert = jest.fn();
  const prisma = {
    catalogSnapshot: { findUnique, upsert },
  } as unknown as PrismaService;
  let service: CatalogSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({});
    service = new CatalogSnapshotService(prisma);
  });

  const key = { provider: 'TPDB', kind: 'SCENE', catalogId: 'scene-1' };

  it('stores what the provider returns', async () => {
    const scene = { id: 'scene-1', title: 'A Scene', performers: [] };

    await expect(
      service.through('TPDB', 'SCENE', ' scene-1 ', () =>
        Promise.resolve(scene),
      ),
    ).resolves.toBe(scene);

    expect(upsert).toHaveBeenCalledWith({
      where: { provider_kind_catalogId: key },
      create: expect.objectContaining({ ...key, data: scene }),
      update: expect.objectContaining({ data: scene }),
    });
  });

  it('answers from the stored copy when the provider is down', async () => {
    const stored = { id: 'scene-1', title: 'Stored' };
    findUnique.mockResolvedValue({ data: stored });

    await expect(
      service.through('TPDB', 'SCENE', 'scene-1', () =>
        Promise.reject(
          new BadGatewayException('Failed to reach TPDB provider endpoint.'),
        ),
      ),
    ).resolves.toEqual(stored);
    expect(findUnique).toHaveBeenCalledWith({
      where: { provider_kind_catalogId: key },
      select: { data: true },
    });
  });

  it('leaves the provider alone for a while after it failed, answering from stored copies', async () => {
    findUnique.mockResolvedValue({ data: { id: 'scene-1' } });
    const down = jest.fn().mockRejectedValue(new Error('fetch failed'));
    await service.through('TPDB', 'SCENE', 'scene-1', down);

    const fetch = jest.fn().mockResolvedValue({ id: 'scene-1' });
    await service.through('TPDB', 'SCENE', 'scene-1', fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(service.inOutage('TPDB')).toBe(true);
    expect(service.inOutage('STASHDB')).toBe(false);

    // Once the hold is over, the provider is asked again.
    jest.useFakeTimers({
      now: Date.now() + CatalogSnapshotService.OUTAGE_HOLD_MS + 1,
    });
    await service.through('TPDB', 'SCENE', 'scene-1', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still asks the provider during an outage when nothing is stored', async () => {
    service.noteOutage('TPDB');
    const fetch = jest.fn().mockResolvedValue({ id: 'scene-2' });

    await expect(
      service.through('TPDB', 'SCENE', 'scene-2', fetch),
    ).resolves.toEqual({
      id: 'scene-2',
    });
    expect(service.inOutage('TPDB')).toBe(false);
  });

  it('passes the error on when the provider is down and nothing is stored', async () => {
    const error = new BadGatewayException('down');
    await expect(
      service.through('TPDB', 'PERFORMER', 'p-1', () => Promise.reject(error)),
    ).rejects.toBe(error);
  });

  it("doesn't stand in for a record the provider says doesn't exist", async () => {
    findUnique.mockResolvedValue({ data: { id: 'scene-1' } });
    const error = new NotFoundException('TPDB resource not found.');

    await expect(
      service.through('TPDB', 'SCENE', 'scene-1', () => Promise.reject(error)),
    ).rejects.toBe(error);
    expect(findUnique).not.toHaveBeenCalled();
    expect(service.inOutage('TPDB')).toBe(false);
  });

  it('never fails a page over the database', async () => {
    upsert.mockRejectedValue(new Error('db down'));
    await expect(
      service.through('TPDB', 'STUDIO', 'st-1', () =>
        Promise.resolve({ id: 'st-1' }),
      ),
    ).resolves.toEqual({ id: 'st-1' });
  });

  it('marks a record missing with no data', async () => {
    await service.markMissing('TPDB', 'SCENE', 'scene-1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ data: Prisma.DbNull }),
      }),
    );
  });

  it('counts unreachable and 5xx as an outage, 4xx as an answer', () => {
    expect(isCatalogOutage(new Error('fetch failed'))).toBe(true);
    expect(isCatalogOutage(new BadGatewayException())).toBe(true);
    expect(isCatalogOutage(new NotFoundException())).toBe(false);
  });
});
