import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogProviderService } from './catalog-provider.service';
import { CatalogSnapshotBackfillService } from './catalog-snapshot-backfill.service';
import { CatalogSnapshotService } from './catalog-snapshot.service';

describe('CatalogSnapshotBackfillService', () => {
  const queryRaw = jest.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const adapter = {
    getSceneById: jest.fn(),
    getPerformerById: jest.fn(),
    getStudioById: jest.fn(),
  };
  const provider = {
    integrationType: 'TPDB',
    providerKey: 'TPDB',
    label: 'ThePornDB',
    baseUrl: 'https://api.theporndb.net',
    apiKey: 'token',
  };
  const catalogProviderService = {
    getConfiguredCatalogProviderOrNull: jest.fn(),
    catalogAdapterFor: jest.fn(() => adapter),
  };
  const snapshots = {
    inOutage: jest.fn(() => false),
    noteOutage: jest.fn(),
    save: jest.fn(),
    markMissing: jest.fn(),
  };
  let service: CatalogSnapshotBackfillService;

  beforeEach(() => {
    jest.clearAllMocks();
    catalogProviderService.getConfiguredCatalogProviderOrNull.mockResolvedValue(
      provider,
    );
    snapshots.inOutage.mockReturnValue(false);
    service = new CatalogSnapshotBackfillService(
      prisma,
      catalogProviderService as unknown as CatalogProviderService,
      snapshots as unknown as CatalogSnapshotService,
    );
  });

  it('stores the library scenes first, then the performers and studios on them', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'scene-1' }]).mockResolvedValueOnce([
      { kind: 'PERFORMER', id: 'p-1' },
      { kind: 'STUDIO', id: 'st-1' },
    ]);
    adapter.getSceneById.mockResolvedValue({ id: 'scene-1' });
    adapter.getPerformerById.mockResolvedValue({ id: 'p-1' });
    adapter.getStudioById.mockResolvedValue({ id: 'st-1' });

    await expect(service.run()).resolves.toBe(3);

    const config = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
    expect(adapter.getSceneById).toHaveBeenCalledWith('scene-1', config);
    expect(adapter.getPerformerById).toHaveBeenCalledWith('p-1', config);
    expect(adapter.getStudioById).toHaveBeenCalledWith('st-1', config);
    expect(snapshots.save).toHaveBeenCalledWith('TPDB', 'SCENE', 'scene-1', {
      id: 'scene-1',
    });
    expect(snapshots.save).toHaveBeenCalledWith('TPDB', 'PERFORMER', 'p-1', {
      id: 'p-1',
    });
    expect(snapshots.save).toHaveBeenCalledWith('TPDB', 'STUDIO', 'st-1', {
      id: 'st-1',
    });
  });

  it('only fetches the scenes when they fill the round', async () => {
    const ids = Array.from(
      { length: CatalogSnapshotBackfillService.PER_RUN },
      (_, i) => ({
        id: `scene-${i}`,
      }),
    );
    queryRaw.mockResolvedValueOnce(ids);
    adapter.getSceneById.mockImplementation((id: string) =>
      Promise.resolve({ id }),
    );

    await expect(service.run()).resolves.toBe(
      CatalogSnapshotBackfillService.PER_RUN,
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('stops for now when the provider is down', async () => {
    queryRaw
      .mockResolvedValueOnce([{ id: 'scene-1' }, { id: 'scene-2' }])
      .mockResolvedValueOnce([]);
    adapter.getSceneById.mockRejectedValue(new BadGatewayException('down'));

    await expect(service.run()).resolves.toBe(0);
    expect(adapter.getSceneById).toHaveBeenCalledTimes(1);
    expect(snapshots.noteOutage).toHaveBeenCalledWith('TPDB');
    expect(snapshots.markMissing).not.toHaveBeenCalled();
  });

  it("marks what the provider doesn't have, so it isn't asked every minute", async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'gone' }]).mockResolvedValueOnce([]);
    adapter.getSceneById.mockRejectedValue(new NotFoundException());

    await service.run();
    expect(snapshots.markMissing).toHaveBeenCalledWith('TPDB', 'SCENE', 'gone');
  });

  it('does nothing without a catalog provider, or while it is known to be down', async () => {
    catalogProviderService.getConfiguredCatalogProviderOrNull.mockResolvedValueOnce(
      null,
    );
    await expect(service.run()).resolves.toBe(0);

    snapshots.inOutage.mockReturnValue(true);
    await expect(service.run()).resolves.toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
