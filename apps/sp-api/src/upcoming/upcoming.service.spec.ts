import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbScene } from '../providers/stashdb/stashdb.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AppSettingsService } from '../settings/app-settings.service';
import { UpcomingService } from './upcoming.service';

const NOW = new Date('2026-10-16T09:00:00Z');

const scene = (id: string, date: string, overrides: Partial<StashdbScene> = {}): StashdbScene => ({
  id,
  title: `Scene ${id}`,
  details: null,
  imageUrl: `https://img/${id}.jpg`,
  studioId: 'st1',
  studioName: 'Anchor Studios',
  studioImageUrl: null,
  date,
  releaseDate: date,
  productionDate: null,
  duration: 1800,
  isFromExcludedNetwork: false,
  ...overrides,
});

describe('UpcomingService', () => {
  let prisma: {
    sceneIndex: { findMany: jest.Mock };
    favoritePerformer: { findMany: jest.Mock };
    favoriteStudio: { findMany: jest.Mock };
  };
  let adapter: {
    getScenesForPerformer: jest.Mock;
    getScenesBySort: jest.Mock;
    getPerformerById: jest.Mock;
  };
  let statuses: { resolveForScenes: jest.Mock };
  let settings: { get: jest.Mock };
  let service: UpcomingService;

  beforeEach(() => {
    prisma = {
      sceneIndex: { findMany: jest.fn().mockResolvedValue([]) },
      favoritePerformer: { findMany: jest.fn().mockResolvedValue([]) },
      favoriteStudio: { findMany: jest.fn().mockResolvedValue([]) },
    };
    adapter = {
      getScenesForPerformer: jest.fn().mockResolvedValue({ scenes: [], total: 0 }),
      getScenesBySort: jest.fn().mockResolvedValue({ scenes: [], total: 0 }),
      getPerformerById: jest.fn().mockResolvedValue({ name: 'Anna Example' }),
    };
    statuses = { resolveForScenes: jest.fn().mockResolvedValue(new Map()) };
    settings = { get: jest.fn().mockResolvedValue({ hideAmateurNetworkResults: false }) };
    const catalog = {
      getConfiguredCatalogProvider: jest.fn().mockResolvedValue({
        integrationType: 'STASHDB',
        providerKey: 'STASHDB',
        baseUrl: 'https://stashdb.test/graphql',
        apiKey: 'key',
      }),
      getConfiguredCatalogAdapter: jest.fn().mockResolvedValue(adapter),
    };
    service = new UpcomingService(
      prisma as unknown as PrismaService,
      catalog as unknown as CatalogProviderService,
      statuses as unknown as SceneStatusService,
      settings as unknown as AppSettingsService,
    );
  });

  it('merges requested scenes and favourites\' releases into one dated list', async () => {
    prisma.sceneIndex.findMany.mockResolvedValue([
      {
        stashId: 'req-1',
        title: 'Requested Soon',
        description: null,
        imageUrl: null,
        studioId: null,
        studioName: 'Banana Films',
        studioImageUrl: null,
        releaseDate: '2026-10-20',
        duration: null,
      },
    ]);
    prisma.favoritePerformer.findMany.mockResolvedValue([{ performerId: 'p1' }]);
    prisma.favoriteStudio.findMany.mockResolvedValue([{ studioId: 'st1' }]);
    // Newest first, as the catalog returns them: the last is before the window.
    adapter.getScenesForPerformer.mockResolvedValue({
      scenes: [scene('both', '2026-11-02'), scene('perf-only', '2026-10-18'), scene('old', '2026-09-01')],
      total: 3,
    });
    adapter.getScenesBySort.mockResolvedValue({
      scenes: [scene('far-future', '2027-12-01'), scene('both', '2026-11-02')],
      total: 2,
    });
    statuses.resolveForScenes.mockResolvedValue(new Map([['req-1', { state: 'REQUESTED' }]]));

    const result = await service.getUpcoming(NOW);

    expect(result).toMatchObject({ from: '2026-10-09', to: '2027-04-14', today: '2026-10-16' });
    expect(result.items.map((item) => [item.id, item.releaseDate])).toEqual([
      ['perf-only', '2026-10-18'],
      ['req-1', '2026-10-20'],
      ['both', '2026-11-02'],
    ]);
    expect(result.items[1]).toMatchObject({ title: 'Requested Soon', requestable: false, reasons: [{ kind: 'REQUESTED' }] });
    expect(result.items[2].reasons).toEqual([
      { kind: 'PERFORMER', id: 'p1', name: 'Anna Example' },
      { kind: 'STUDIO', id: 'st1', name: 'Anchor Studios' },
    ]);
    expect(result.items[0]).toMatchObject({ requestable: true, status: { state: 'NOT_REQUESTED' } });
    // Reached a past release on the first page, so no second page.
    expect(adapter.getScenesForPerformer).toHaveBeenCalledTimes(1);
  });

  it('labels a favourite\'s scene you have already requested as Requested', async () => {
    prisma.favoriteStudio.findMany.mockResolvedValue([{ studioId: 'st1' }]);
    adapter.getScenesBySort.mockResolvedValue({ scenes: [scene('s1', '2026-10-25')], total: 1 });
    statuses.resolveForScenes.mockResolvedValue(new Map([['s1', { state: 'DOWNLOADING' }]]));

    const [item] = (await service.getUpcoming(NOW)).items;

    expect(item.reasons.map((reason) => reason.kind)).toEqual(['REQUESTED', 'STUDIO']);
    expect(item.requestable).toBe(false);
  });

  it('respects hiding amateur networks for favourites', async () => {
    settings.get.mockResolvedValue({ hideAmateurNetworkResults: true });
    prisma.favoriteStudio.findMany.mockResolvedValue([{ studioId: 'st1' }]);
    adapter.getScenesBySort.mockResolvedValue({
      scenes: [scene('amateur', '2026-10-25', { isFromExcludedNetwork: true }), scene('pro', '2026-10-26')],
      total: 2,
    });

    const result = await service.getUpcoming(NOW);

    expect(result.items.map((item) => item.id)).toEqual(['pro']);
  });

  it('leaves out a favourite that fails to load instead of failing the page', async () => {
    prisma.favoritePerformer.findMany.mockResolvedValue([{ performerId: 'p1' }]);
    prisma.favoriteStudio.findMany.mockResolvedValue([{ studioId: 'st1' }]);
    adapter.getScenesForPerformer.mockRejectedValue(new Error('catalog down'));
    adapter.getScenesBySort.mockResolvedValue({ scenes: [scene('s1', '2026-10-25')], total: 1 });

    const result = await service.getUpcoming(NOW);

    expect(result.items.map((item) => item.id)).toEqual(['s1']);
  });

  it('caches favourites\' releases between visits', async () => {
    prisma.favoriteStudio.findMany.mockResolvedValue([{ studioId: 'st1' }]);
    adapter.getScenesBySort.mockResolvedValue({ scenes: [scene('s1', '2026-10-25')], total: 1 });

    await service.getUpcoming(NOW);
    await service.getUpcoming(NOW);

    expect(adapter.getScenesBySort).toHaveBeenCalledTimes(1);
  });

  it('skips the catalog entirely with no favourites', async () => {
    const result = await service.getUpcoming(NOW);

    expect(result.items).toEqual([]);
    expect(adapter.getScenesBySort).not.toHaveBeenCalled();
    expect(adapter.getScenesForPerformer).not.toHaveBeenCalled();
  });
});
