import { MonitoredPerformer } from '@prisma/client';
import { PerformerMonitoringService } from './performer-monitoring.service';

describe('PerformerMonitoringService', () => {
  const monitoredSince = new Date('2026-10-05T15:30:00.000Z');

  let row: MonitoredPerformer;
  let sceneResults: Array<{ id: string; releaseDate: string | null }>;
  let sceneStatuses: Map<string, { state: string }>;

  const prisma = {
    monitoredPerformer: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const catalogAdapter = { getScenesForPerformer: jest.fn() };
  const catalogProviderService = {
    getConfiguredCatalogProvider: jest
      .fn()
      .mockResolvedValue({ baseUrl: 'http://catalog.local', apiKey: 'key' }),
    getConfiguredCatalogAdapter: jest.fn().mockResolvedValue(catalogAdapter),
  };
  const sceneStatusService = { resolveForScenes: jest.fn() };
  const appSettingsService = { get: jest.fn() };
  const requestsService = { submitSceneRequest: jest.fn() };

  let service: PerformerMonitoringService;

  beforeEach(() => {
    jest.clearAllMocks();
    row = {
      id: 'row-1',
      performerId: 'performer-1',
      monitoredSince,
      lastCheckedAt: null,
      handledSceneIds: [],
      createdAt: monitoredSince,
    };
    sceneResults = [];
    sceneStatuses = new Map();

    catalogAdapter.getScenesForPerformer.mockImplementation(async () => ({
      total: sceneResults.length,
      scenes: sceneResults.map((scene) => ({
        ...scene,
        title: scene.id,
        date: null,
      })),
    }));
    sceneStatusService.resolveForScenes.mockImplementation(async () => sceneStatuses);
    appSettingsService.get.mockResolvedValue({
      defaultRootFolderPath: '/data',
      defaultQualityProfileId: 4,
      defaultMonitored: true,
      defaultSearchForMovie: true,
      defaultTagIds: [],
    });
    requestsService.submitSceneRequest.mockResolvedValue({});
    prisma.monitoredPerformer.update.mockResolvedValue(row);

    service = new PerformerMonitoringService(
      prisma as never,
      catalogProviderService as never,
      sceneStatusService as never,
      appSettingsService as never,
      requestsService as never,
    );
  });

  it('requests scenes released on or after the day monitoring started, never earlier ones', async () => {
    sceneResults = [
      { id: 'upcoming', releaseDate: '2026-11-01' },
      { id: 'same-day', releaseDate: '2026-10-05' },
      { id: 'past', releaseDate: '2026-10-04' },
      { id: 'old', releaseDate: '2024-01-01' },
    ];

    const requested = await service.checkPerformer(row);

    expect(requested).toBe(2);
    expect(requestsService.submitSceneRequest.mock.calls.map((call) => call[0])).toEqual([
      'upcoming',
      'same-day',
    ]);
  });

  it('skips scenes with no release date', async () => {
    sceneResults = [{ id: 'undated', releaseDate: null }];

    expect(await service.checkPerformer(row)).toBe(0);
    expect(requestsService.submitSceneRequest).not.toHaveBeenCalled();
  });

  it('does not re-request a scene it already handled', async () => {
    row.handledSceneIds = ['upcoming'];
    sceneResults = [{ id: 'upcoming', releaseDate: '2026-11-01' }];

    expect(await service.checkPerformer(row)).toBe(0);
    expect(requestsService.submitSceneRequest).not.toHaveBeenCalled();
  });

  it('marks scenes that are already requested or available as handled without requesting them', async () => {
    sceneResults = [{ id: 'already', releaseDate: '2026-11-01' }];
    sceneStatuses = new Map([['already', { state: 'AVAILABLE' }]]);

    expect(await service.checkPerformer(row)).toBe(0);
    expect(requestsService.submitSceneRequest).not.toHaveBeenCalled();
    expect(prisma.monitoredPerformer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ handledSceneIds: ['already'] }),
      }),
    );
  });

  it('leaves scenes unhandled when no default download profile is saved', async () => {
    appSettingsService.get.mockResolvedValue({
      defaultRootFolderPath: null,
      defaultQualityProfileId: null,
      defaultMonitored: true,
      defaultSearchForMovie: true,
      defaultTagIds: [],
    });
    sceneResults = [{ id: 'upcoming', releaseDate: '2026-11-01' }];

    expect(await service.checkPerformer(row)).toBe(0);
    expect(requestsService.submitSceneRequest).not.toHaveBeenCalled();
    expect(prisma.monitoredPerformer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ handledSceneIds: [] }),
      }),
    );
  });

  it('retries a scene on the next pass when its request fails', async () => {
    sceneResults = [{ id: 'upcoming', releaseDate: '2026-11-01' }];
    requestsService.submitSceneRequest.mockRejectedValue(new Error('whisparr down'));

    expect(await service.checkPerformer(row)).toBe(0);
    expect(prisma.monitoredPerformer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ handledSceneIds: [] }),
      }),
    );
  });

  it('keeps the original start date when monitoring is enabled again', async () => {
    prisma.monitoredPerformer.findUnique.mockResolvedValue(row);

    const state = await service.setMonitored('performer-1', true);

    expect(prisma.monitoredPerformer.create).not.toHaveBeenCalled();
    expect(state).toEqual({
      monitored: true,
      monitoredSince: monitoredSince.toISOString(),
    });
  });

  it('removes the monitor when switched off', async () => {
    const state = await service.setMonitored('performer-1', false);

    expect(prisma.monitoredPerformer.deleteMany).toHaveBeenCalledWith({
      where: { performerId: 'performer-1' },
    });
    expect(state).toEqual({ monitored: false, monitoredSince: null });
  });
});
