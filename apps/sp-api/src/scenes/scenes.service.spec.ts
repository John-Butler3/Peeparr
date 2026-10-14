import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PerformerFavoritesService } from '../performers/performer-favorites.service';
import { PerformerImagePreferenceService } from '../performers/performer-image-preference.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import type { CatalogAdapter } from '../providers/catalog/catalog-adapter.interface';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbSceneDetails } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AppSettingsService } from '../settings/app-settings.service';
import { TpdbWebService } from '../tpdb-web/tpdb-web.service';
import { ScenesService } from './scenes.service';

describe('ScenesService', () => {
  let tpdbWebService: TpdbWebService;
  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;
  const catalogProviderService = {
    getConfiguredCatalogProvider: jest.fn(),
    getConfiguredCatalogAdapter: jest.fn(),
  } as unknown as CatalogProviderService;

  const catalogAdapter = {
    getSceneById: jest.fn(),
    getScenesBySort: jest.fn(),
    getScenesForPerformer: jest.fn(),
    searchTags: jest.fn(),
    favoriteStudio: jest.fn(),
  } as unknown as CatalogAdapter;

  const sceneStatusService = {
    resolveForScene: jest.fn(),
  } as unknown as SceneStatusService;

  const stashAdapter = {
    findScenesByStashId: jest.fn(),
    getSceneStreamUrl: jest.fn(),
  } as unknown as StashAdapter;

  const whisparrAdapter = {
    findMovieByStashId: jest.fn(),
    buildSceneViewUrl: jest.fn(),
  } as unknown as WhisparrAdapter;

  const appSettingsService = {
    get: jest.fn(),
  } as unknown as AppSettingsService;

  const performerFavoritesService = {
    listAllFavoriteIds: jest.fn(),
  } as unknown as PerformerFavoritesService;

  const performerImagePreferenceService = {
    getMainImageUrls: jest.fn(),
  } as unknown as PerformerImagePreferenceService;

  const stashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local',
    apiKey: 'stashdb-key',
  };

  const stashIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stash.local',
    apiKey: 'stash-key',
  };

  const whisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'whisparr-key',
  };

  const sceneDetails: StashdbSceneDetails = {
    id: 'stashdb-scene-1',
    title: 'Scene',
    details: 'Description',
    imageUrl: 'http://cdn.local/image.jpg',
    images: [],
    studioId: 'studio-1',
    studioIsFavorite: false,
    studioName: 'Studio',
    studioImageUrl: 'http://studio-image',
    releaseDate: '2026-01-01',
    duration: 300,
    tags: [],
    performers: [],
    sourceUrls: [],
  };

  let service: ScenesService;

  beforeEach(() => {
    jest.clearAllMocks();
    tpdbWebService = { getPopularScenes: jest.fn().mockResolvedValue([]) } as unknown as TpdbWebService;
    service = new ScenesService(
      integrationsService,
      catalogProviderService,
      sceneStatusService,
      stashAdapter,
      whisparrAdapter,
      appSettingsService,
      performerFavoritesService,
      performerImagePreferenceService,
      tpdbWebService,
    );

    performerImagePreferenceService.getMainImageUrls = jest.fn().mockResolvedValue(new Map());

    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.STASH) {
          return stashIntegration;
        }

        if (type === IntegrationType.WHISPARR) {
          return whisparrIntegration;
        }

        throw new Error('Unexpected integration type');
      });
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'STASHDB',
        providerKey: 'STASHDB',
        label: 'StashDB',
        baseUrl: stashdbIntegration.baseUrl,
        apiKey: stashdbIntegration.apiKey,
      });
    catalogProviderService.getConfiguredCatalogAdapter = jest
      .fn()
      .mockResolvedValue(catalogAdapter);

    catalogAdapter.getSceneById = jest.fn().mockResolvedValue(sceneDetails);
    catalogAdapter.getScenesBySort = jest.fn().mockResolvedValue({
      total: 1,
      scenes: [
        {
          id: 'stashdb-scene-1',
          title: 'Scene',
          details: 'Description',
          imageUrl: 'http://cdn.local/image.jpg',
          studioId: 'studio-1',
          studioName: 'Studio',
          studioImageUrl: 'http://studio-image',
          date: '2026-01-01',
          releaseDate: '2026-01-02',
          productionDate: '2026-01-03',
          duration: 300,
        },
      ],
    });
    catalogAdapter.searchTags = jest.fn().mockResolvedValue([]);
    catalogAdapter.favoriteStudio = jest.fn().mockResolvedValue({
      favorited: true,
      alreadyFavorited: false,
    });
    sceneStatusService.resolveForScene = jest
      .fn()
      .mockResolvedValue({ state: 'AVAILABLE' });
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(
        new Map([['stashdb-scene-1', { state: 'AVAILABLE' }]]),
      );
    appSettingsService.get = jest
      .fn()
      .mockResolvedValue({ hideAmateurNetworkResults: false });
    performerFavoritesService.listAllFavoriteIds = jest.fn().mockResolvedValue([]);
    stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([]);
    whisparrAdapter.findMovieByStashId = jest.fn().mockResolvedValue(null);
    whisparrAdapter.buildSceneViewUrl = jest
      .fn()
      .mockReturnValue('http://whisparr.local/movie/stashdb-scene-1');
  });

  it('enriches scene details with stash availability when stash copies exist', async () => {
    stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([
      {
        id: '3027',
        width: 3840,
        height: 2160,
        viewUrl: 'http://stash.local/scene/3027',
        label: '2160p',
      },
      {
        id: '3030',
        width: 1920,
        height: 1080,
        viewUrl: 'http://stash.local/scene/3030',
        label: '1080p',
      },
    ]);

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: {
        exists: true,
        hasMultipleCopies: true,
        copies: [
          { id: '3027', label: '2160p' },
          { id: '3030', label: '1080p' },
        ],
      },
      whisparr: null,
    });
    expect(stashAdapter.findScenesByStashId).toHaveBeenCalledWith(
      'stashdb-scene-1',
      {
        baseUrl: stashIntegration.baseUrl,
        apiKey: stashIntegration.apiKey,
      },
    );
  });

  it('recognizes a scene as available in Stash even when it was tagged under a previously-configured catalog provider', async () => {
    // findScenesByStashId itself is provider-agnostic now (no providerKey
    // overlay passed) -- Stash can find a scene by id regardless of which
    // endpoint originally tagged it, so a copy list coming back at all means
    // it's available, independent of which provider is active today.
    stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([
      {
        id: '3027',
        width: 1920,
        height: 1080,
        viewUrl: 'http://stash.local/scene/3027',
        label: '1080p',
        duration: 600,
        resumeSeconds: 0,
      },
    ]);

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      stash: {
        exists: true,
        hasMultipleCopies: false,
      },
    });
    expect(stashAdapter.findScenesByStashId).toHaveBeenCalledWith(
      'stashdb-scene-1',
      {
        baseUrl: stashIntegration.baseUrl,
        apiKey: stashIntegration.apiKey,
      },
    );
  });

  it('defaults to TRENDING sort for scenes feed and returns statuses', async () => {
    await expect(service.getScenesFeed()).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [
        {
          id: 'stashdb-scene-1',
          title: 'Scene',
          description: 'Description',
          imageUrl: 'http://cdn.local/image.jpg',
          cardImageUrl: 'http://cdn.local/image.jpg?size=600',
          studioId: 'studio-1',
          studio: 'Studio',
          studioImageUrl: 'http://studio-image',
          releaseDate: '2026-01-02',
          duration: 300,
          type: 'SCENE',
          source: 'STASHDB',
          status: { state: 'AVAILABLE' },
          requestable: false,
        },
      ],
    });

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 24,
      sort: 'TRENDING',
      direction: 'DESC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: [],
    });
    expect(stashAdapter.findScenesByStashId).not.toHaveBeenCalled();
  });

  it('hides a non-library excluded-network scene when hideAmateurNetworkResults is on', async () => {
    appSettingsService.get = jest
      .fn()
      .mockResolvedValue({ hideAmateurNetworkResults: true });
    catalogAdapter.getScenesBySort = jest.fn().mockResolvedValue({
      total: 2,
      scenes: [
        {
          id: 'stashdb-scene-1',
          title: 'Scene',
          details: 'Description',
          imageUrl: 'http://cdn.local/image.jpg',
          studioId: 'studio-1',
          studioName: 'Studio',
          studioImageUrl: 'http://studio-image',
          date: '2026-01-01',
          releaseDate: '2026-01-02',
          productionDate: '2026-01-03',
          duration: 300,
          isFromExcludedNetwork: false,
        },
        {
          id: 'amateur-scene-1',
          title: 'Amateur Scene',
          details: null,
          imageUrl: null,
          studioId: null,
          studioName: null,
          studioImageUrl: null,
          date: null,
          releaseDate: null,
          productionDate: null,
          duration: null,
          isFromExcludedNetwork: true,
        },
      ],
    });
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(
        new Map([
          ['stashdb-scene-1', { state: 'AVAILABLE' }],
          ['amateur-scene-1', { state: 'NOT_REQUESTED' }],
        ]),
      );

    const result = await service.getScenesFeed();

    expect(result.items.map((item) => item.id)).toEqual(['stashdb-scene-1']);
    // The whole feed has been read (one short provider page), so the count is
    // what's actually visible.
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('reads ahead past a flood of hidden amateur scenes to fill the page, and carries on from there', async () => {
    appSettingsService.get = jest.fn().mockResolvedValue({ hideAmateurNetworkResults: true });
    // 10 scenes per provider page; only every 5th one is not amateur.
    const providerScene = (n: number) => ({
      id: `scene-${n}`,
      title: `Scene ${n}`,
      details: null,
      imageUrl: null,
      studioId: null,
      studioName: null,
      studioImageUrl: null,
      date: null,
      releaseDate: null,
      productionDate: null,
      duration: null,
      isFromExcludedNetwork: n % 5 !== 0,
    });
    catalogAdapter.getScenesBySort = jest.fn(({ page }: { page: number }) =>
      Promise.resolve({
        total: 1000,
        scenes: Array.from({ length: 10 }, (_, i) => providerScene((page - 1) * 10 + i + 1)),
      }),
    );
    sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

    const first = await service.getScenesFeed(1, 10);
    expect(first.items).toHaveLength(10);
    expect(first.items.map((item) => item.id).slice(0, 3)).toEqual(['scene-5', 'scene-10', 'scene-15']);
    expect(first.hasMore).toBe(true);
    const providerCalls = (catalogAdapter.getScenesBySort as jest.Mock).mock.calls.length;

    // Page 2 continues from the read-ahead rather than starting over.
    const second = await service.getScenesFeed(2, 10);
    expect(second.items[0].id).toBe('scene-55');
    const pagesForSecond = (catalogAdapter.getScenesBySort as jest.Mock).mock.calls
      .slice(providerCalls)
      .map(([args]: [{ page: number }]) => args.page);
    expect(Math.min(...pagesForSecond)).toBeGreaterThan(5);
  });

  it('keeps an already-library excluded-network scene visible even when hideAmateurNetworkResults is on', async () => {
    appSettingsService.get = jest
      .fn()
      .mockResolvedValue({ hideAmateurNetworkResults: true });
    catalogAdapter.getScenesBySort = jest.fn().mockResolvedValue({
      total: 1,
      scenes: [
        {
          id: 'amateur-scene-1',
          title: 'Amateur Scene',
          details: null,
          imageUrl: null,
          studioId: null,
          studioName: null,
          studioImageUrl: null,
          date: null,
          releaseDate: null,
          productionDate: null,
          duration: null,
          isFromExcludedNetwork: true,
        },
      ],
    });
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(
        new Map([['amateur-scene-1', { state: 'AVAILABLE' }]]),
      );

    const result = await service.getScenesFeed();

    expect(result.items.map((item) => item.id)).toEqual(['amateur-scene-1']);
  });

  describe('favorites: PERFORMER', () => {
    function buildScene(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'scene-1',
        title: 'Scene One',
        details: null,
        imageUrl: null,
        studioId: 'studio-1',
        studioName: 'Studio',
        studioImageUrl: null,
        date: '2026-01-01',
        releaseDate: '2026-01-01',
        productionDate: null,
        duration: 300,
        isFromExcludedNetwork: false,
        ...overrides,
      };
    }

    it('bypasses the provider feed entirely and aggregates favorited performers own scenes', async () => {
      performerFavoritesService.listAllFavoriteIds = jest
        .fn()
        .mockResolvedValue(['performer-1', 'performer-2']);
      catalogAdapter.getScenesForPerformer = jest
        .fn()
        .mockImplementation((config: { performerId: string }) =>
          Promise.resolve({
            total: 1,
            scenes: [buildScene({ id: `${config.performerId}-scene` })],
          }),
        );
      sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

      const result = await service.getScenesFeed(1, 24, 'TRENDING', 'DESC', [], 'OR', 'PERFORMER');

      expect(catalogAdapter.getScenesBySort).not.toHaveBeenCalled();
      expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledTimes(2);
      expect(result.items.map((item) => item.id).sort()).toEqual([
        'performer-1-scene',
        'performer-2-scene',
      ]);
      expect(result.total).toBe(2);
    });

    it('returns an empty feed without calling the provider when nothing is favorited', async () => {
      performerFavoritesService.listAllFavoriteIds = jest.fn().mockResolvedValue([]);

      const result = await service.getScenesFeed(1, 24, 'TRENDING', 'DESC', [], 'OR', 'PERFORMER');

      expect(catalogAdapter.getScenesForPerformer).not.toHaveBeenCalled();
      expect(result).toEqual({ total: 0, page: 1, perPage: 24, hasMore: false, items: [] });
    });

    it('dedupes a scene shared by two favorited performers', async () => {
      performerFavoritesService.listAllFavoriteIds = jest
        .fn()
        .mockResolvedValue(['performer-1', 'performer-2']);
      catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
        total: 1,
        scenes: [buildScene({ id: 'shared-scene' })],
      });
      sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

      const result = await service.getScenesFeed(1, 24, 'TRENDING', 'DESC', [], 'OR', 'PERFORMER');

      expect(result.items.map((item) => item.id)).toEqual(['shared-scene']);
      expect(result.total).toBe(1);
    });

    it('drops a performer whose scenes fail to load instead of failing the whole feed', async () => {
      performerFavoritesService.listAllFavoriteIds = jest
        .fn()
        .mockResolvedValue(['performer-1', 'performer-2']);
      catalogAdapter.getScenesForPerformer = jest
        .fn()
        .mockImplementation((config: { performerId: string }) => {
          if (config.performerId === 'performer-2') {
            return Promise.reject(new Error('not found'));
          }
          return Promise.resolve({
            total: 1,
            scenes: [buildScene({ id: 'performer-1-scene' })],
          });
        });
      sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

      const result = await service.getScenesFeed(1, 24, 'TRENDING', 'DESC', [], 'OR', 'PERFORMER');

      expect(result.items.map((item) => item.id)).toEqual(['performer-1-scene']);
    });

    it('filters the aggregated scenes by studio and title query locally', async () => {
      performerFavoritesService.listAllFavoriteIds = jest.fn().mockResolvedValue(['performer-1']);
      catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
        total: 2,
        scenes: [
          buildScene({ id: 'scene-a', title: 'Beach Day', studioId: 'studio-1' }),
          buildScene({ id: 'scene-b', title: 'Night Out', studioId: 'studio-2' }),
        ],
      });
      sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

      const result = await service.getScenesFeed(
        1,
        24,
        'TRENDING',
        'DESC',
        [],
        'OR',
        'PERFORMER',
        ['studio-1'],
        'beach',
      );

      expect(result.items.map((item) => item.id)).toEqual(['scene-a']);
    });

    it('sorts the aggregated scenes by title when requested', async () => {
      performerFavoritesService.listAllFavoriteIds = jest.fn().mockResolvedValue(['performer-1']);
      catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
        total: 2,
        scenes: [
          buildScene({ id: 'scene-z', title: 'Zebra' }),
          buildScene({ id: 'scene-a', title: 'Antelope' }),
        ],
      });
      sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

      const result = await service.getScenesFeed(1, 24, 'TITLE', 'ASC', [], 'OR', 'PERFORMER');

      expect(result.items.map((item) => item.id)).toEqual(['scene-a', 'scene-z']);
    });

    it('paginates the locally-aggregated feed', async () => {
      performerFavoritesService.listAllFavoriteIds = jest.fn().mockResolvedValue(['performer-1']);
      catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
        total: 3,
        scenes: [
          buildScene({ id: 'scene-1', releaseDate: '2026-01-01' }),
          buildScene({ id: 'scene-2', releaseDate: '2026-01-02' }),
          buildScene({ id: 'scene-3', releaseDate: '2026-01-03' }),
        ],
      });
      sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

      const result = await service.getScenesFeed(1, 2, 'DATE', 'DESC', [], 'OR', 'PERFORMER');

      expect(result.items.map((item) => item.id)).toEqual(['scene-3', 'scene-2']);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it('still hides excluded-network favorite-performer scenes not already in the library', async () => {
      appSettingsService.get = jest
        .fn()
        .mockResolvedValue({ hideAmateurNetworkResults: true });
      performerFavoritesService.listAllFavoriteIds = jest.fn().mockResolvedValue(['performer-1']);
      catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
        total: 1,
        scenes: [buildScene({ id: 'amateur-scene', isFromExcludedNetwork: true })],
      });
      sceneStatusService.resolveForScenes = jest
        .fn()
        .mockResolvedValue(new Map([['amateur-scene', { state: 'NOT_REQUESTED' }]]));

      const result = await service.getScenesFeed(1, 24, 'TRENDING', 'DESC', [], 'OR', 'PERFORMER');

      expect(result.items).toEqual([]);
    });
  });

  it('uses the active FANSDB provider for discovery feed and scene detail source', async () => {
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'FANSDB',
        providerKey: 'FANSDB',
        label: 'FansDB',
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      });

    await expect(service.getScenesFeed()).resolves.toMatchObject({
      items: [expect.objectContaining({ source: 'FANSDB' })],
    });
    await expect(service.getSceneById('stashdb-scene-1')).resolves.toMatchObject({
      source: 'FANSDB',
    });

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      }),
    );
    expect(catalogAdapter.getSceneById).toHaveBeenCalledWith(
      'stashdb-scene-1',
      {
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      },
    );
    expect(stashAdapter.findScenesByStashId).toHaveBeenCalledWith(
      'stashdb-scene-1',
      {
        baseUrl: stashIntegration.baseUrl,
        apiKey: stashIntegration.apiKey,
      },
    );
  });

  it('applies a saved main-image override to scene cast members', async () => {
    catalogAdapter.getSceneById = jest.fn().mockResolvedValue({
      ...sceneDetails,
      performers: [
        {
          id: 'performer-1',
          name: 'Performer One',
          gender: 'FEMALE',
          isFavorite: false,
          imageUrl: 'http://cdn.local/default.jpg',
        },
        {
          id: 'performer-2',
          name: 'Performer Two',
          gender: 'FEMALE',
          isFavorite: false,
          imageUrl: 'http://cdn.local/performer-2.jpg',
        },
      ],
    });
    performerImagePreferenceService.getMainImageUrls = jest
      .fn()
      .mockResolvedValue(new Map([['performer-1', 'http://cdn.local/chosen.jpg']]));

    const result = await service.getSceneById('stashdb-scene-1');

    expect(performerImagePreferenceService.getMainImageUrls).toHaveBeenCalledWith([
      'performer-1',
      'performer-2',
    ]);
    expect(result.performers).toEqual([
      expect.objectContaining({
        id: 'performer-1',
        imageUrl: 'http://cdn.local/chosen.jpg',
        cardImageUrl: 'http://cdn.local/chosen.jpg?size=300',
      }),
      expect.objectContaining({
        id: 'performer-2',
        imageUrl: 'http://cdn.local/performer-2.jpg',
      }),
    ]);
  });

  it('dispatches to the TPDB catalog adapter when TPDB is the active provider', async () => {
    const tpdbAdapter = {
      getScenesBySort: jest.fn().mockResolvedValue({
        total: 1,
        scenes: [
          {
            id: 'tpdb-scene-1',
            title: 'TPDB Scene',
            details: null,
            imageUrl: null,
            studioId: null,
            studioName: null,
            studioImageUrl: null,
            releaseDate: null,
            duration: null,
          },
        ],
      }),
    };

    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'TPDB',
        providerKey: 'TPDB',
        label: 'ThePornDB',
        baseUrl: 'https://api.theporndb.net',
        apiKey: 'tpdb-token',
      });
    catalogProviderService.getConfiguredCatalogAdapter = jest
      .fn()
      .mockResolvedValue(tpdbAdapter);

    await expect(service.getScenesFeed()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'tpdb-scene-1', source: 'TPDB' })],
    });

    expect(tpdbAdapter.getScenesBySort).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.theporndb.net',
        apiKey: 'tpdb-token',
      }),
    );
    expect(catalogAdapter.getScenesBySort).not.toHaveBeenCalled();
  });

  it('forwards non-default sort to stashdb adapter', async () => {
    await service.getScenesFeed(2, 10, 'TITLE');

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 2,
      perPage: 10,
      sort: 'TITLE',
      direction: 'DESC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('forwards ALL favorites filter to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', undefined, [], 'OR', 'ALL');

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'ALL',
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('forwards PERFORMER favorites filter to stashdb adapter', async () => {
    await service.getScenesFeed(
      1,
      25,
      'DATE',
      undefined,
      [],
      'OR',
      'PERFORMER',
    );

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'PERFORMER',
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('marks NOT_REQUESTED discovery scenes as requestable from status resolution', async () => {
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(
        new Map([['stashdb-scene-1', { state: 'NOT_REQUESTED' }]]),
      );

    await expect(service.getScenesFeed(1, 25, 'DATE')).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 25,
      hasMore: false,
      items: [
        expect.objectContaining({
          id: 'stashdb-scene-1',
          status: { state: 'NOT_REQUESTED' },
          requestable: true,
        }),
      ],
    });

    expect(stashAdapter.findScenesByStashId).not.toHaveBeenCalled();
  });

  it('forwards STUDIO favorites filter to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', undefined, [], 'OR', 'STUDIO');

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'STUDIO',
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('forwards selected tags and AND mode to stashdb adapter', async () => {
    await service.getScenesFeed(
      1,
      25,
      'DATE',
      undefined,
      ['t-1', 't-2', 't-1'],
      'AND',
      'PERFORMER',
    );

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'PERFORMER',
      tagFilter: {
        tagIds: ['t-1', 't-2'],
        mode: 'AND',
      },
      studioIds: [],
    });
  });

  it('forwards normalized studioIds to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', undefined, [], 'OR', undefined, [
      'studio-1',
      'studio-1',
      'studio-2',
    ]);

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'DESC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: ['studio-1', 'studio-2'],
    });
  });

  it('forwards explicit sort direction to stashdb adapter', async () => {
    await service.getScenesFeed(1, 25, 'DATE', 'ASC');

    expect(catalogAdapter.getScenesBySort).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'ASC',
      favorites: undefined,
      tagFilter: undefined,
      studioIds: [],
    });
  });

  it('returns scene tag options from stashdb', async () => {
    catalogAdapter.searchTags = jest.fn().mockResolvedValue([
      {
        id: 'tag-1',
        name: 'Tag One',
        description: null,
        aliases: ['Alias 1'],
      },
    ]);

    await expect(service.searchSceneTags('tag')).resolves.toEqual([
      {
        id: 'tag-1',
        name: 'Tag One',
        description: null,
        aliases: ['Alias 1'],
      },
    ]);

    expect(catalogAdapter.searchTags).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      query: 'tag',
    });
  });

  it('returns stash null when stash integration is unavailable', async () => {
    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.WHISPARR) {
          return whisparrIntegration;
        }

        throw new Error('stash unavailable');
      });

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: null,
      whisparr: null,
    });
  });

  it('returns stash null when stash provider fails', async () => {
    stashAdapter.findScenesByStashId = jest
      .fn()
      .mockRejectedValue(new Error('provider failed'));

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: null,
      whisparr: null,
    });
  });

  it('enriches scene details with whisparr view link when scene exists in whisparr', async () => {
    whisparrAdapter.findMovieByStashId = jest.fn().mockResolvedValue({
      movieId: 44,
      stashId: 'stashdb-scene-1',
      hasFile: false,
    });

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      whisparr: {
        exists: true,
        viewUrl: 'http://whisparr.local/movie/stashdb-scene-1',
      },
    });
  });

  it('returns whisparr null when whisparr provider fails', async () => {
    whisparrAdapter.findMovieByStashId = jest
      .fn()
      .mockRejectedValue(new Error('provider failed'));

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      whisparr: null,
    });
  });

  it('favorites studio by id', async () => {
    await expect(service.favoriteStudio('studio-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });

    expect(catalogAdapter.favoriteStudio).toHaveBeenCalledWith(
      'studio-1',
      true,
      {
        baseUrl: stashdbIntegration.baseUrl,
        apiKey: stashdbIntegration.apiKey,
      },
    );
  });

  it('favorites a studio through whichever catalog adapter is configured (e.g. TPDB)', async () => {
    const tpdbProvider = {
      integrationType: 'TPDB',
      providerKey: 'TPDB',
      label: 'ThePornDB',
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'tpdb-token',
    };
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue(tpdbProvider);

    await expect(service.favoriteStudio('studio-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });
    expect(catalogAdapter.favoriteStudio).toHaveBeenCalledWith(
      'studio-1',
      true,
      {
        baseUrl: tpdbProvider.baseUrl,
        apiKey: tpdbProvider.apiKey,
      },
    );
  });

  describe('getSimilarScenes', () => {
    function buildCandidate(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'candidate-1',
        title: 'Candidate Scene',
        details: null,
        imageUrl: null,
        studioId: 'studio-1',
        studioName: 'Studio',
        studioImageUrl: null,
        date: '2026-01-01',
        releaseDate: '2026-01-01',
        productionDate: null,
        duration: 300,
        isFromExcludedNetwork: false,
        ...overrides,
      };
    }

    it('returns an empty rail without calling the provider when the scene has no performers', async () => {
      catalogAdapter.getSceneById = jest
        .fn()
        .mockResolvedValue({ ...sceneDetails, performers: [] });

      const result = await service.getSimilarScenes('stashdb-scene-1');

      expect(catalogAdapter.getScenesForPerformer).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [] });
    });

    it('only seeds the search from female cast members', async () => {
      catalogAdapter.getSceneById = jest.fn().mockResolvedValue({
        ...sceneDetails,
        performers: [
          { id: 'performer-1', name: 'A', gender: 'FEMALE', isFavorite: false, imageUrl: null },
          { id: 'performer-2', name: 'B', gender: 'MALE', isFavorite: false, imageUrl: null },
          { id: 'performer-3', name: 'C', gender: null, isFavorite: false, imageUrl: null },
        ],
      });
      catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
        total: 1,
        scenes: [buildCandidate({ id: 'female-cast-scene' })],
      });
      sceneStatusService.resolveForScenes = jest
        .fn()
        .mockResolvedValue(new Map([['female-cast-scene', { state: 'AVAILABLE' }]]));

      const result = await service.getSimilarScenes('stashdb-scene-1');

      expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledTimes(1);
      expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledWith(
        expect.objectContaining({ performerId: 'performer-1' }),
      );
      expect(result.items.map((item) => item.id)).toEqual(['female-cast-scene']);
    });

    it('aggregates each cast member scenes, dedupes, excludes the current scene, and keeps only library scenes', async () => {
      catalogAdapter.getSceneById = jest.fn().mockResolvedValue({
        ...sceneDetails,
        id: 'current-scene',
        performers: [
          { id: 'performer-1', name: 'A', gender: 'FEMALE', isFavorite: false, imageUrl: null },
          { id: 'performer-2', name: 'B', gender: 'FEMALE', isFavorite: false, imageUrl: null },
        ],
      });
      catalogAdapter.getScenesForPerformer = jest
        .fn()
        .mockImplementation((config: { performerId: string }) => {
          if (config.performerId === 'performer-1') {
            return Promise.resolve({
              total: 2,
              scenes: [
                buildCandidate({ id: 'shared-scene' }),
                buildCandidate({ id: 'current-scene' }),
              ],
            });
          }

          return Promise.resolve({
            total: 2,
            scenes: [
              buildCandidate({ id: 'shared-scene' }),
              buildCandidate({ id: 'not-in-library' }),
            ],
          });
        });
      sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(
        new Map([
          ['shared-scene', { state: 'AVAILABLE' }],
          ['current-scene', { state: 'AVAILABLE' }],
          ['not-in-library', { state: 'NOT_REQUESTED' }],
        ]),
      );

      const result = await service.getSimilarScenes('current-scene');

      expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledTimes(2);
      expect(result.items.map((item) => item.id)).toEqual(['shared-scene']);
    });

    it('drops a performer whose scenes fail to load instead of failing the whole rail', async () => {
      catalogAdapter.getSceneById = jest.fn().mockResolvedValue({
        ...sceneDetails,
        performers: [
          { id: 'performer-1', name: 'A', gender: 'FEMALE', isFavorite: false, imageUrl: null },
          { id: 'performer-2', name: 'B', gender: 'FEMALE', isFavorite: false, imageUrl: null },
        ],
      });
      catalogAdapter.getScenesForPerformer = jest
        .fn()
        .mockImplementation((config: { performerId: string }) => {
          if (config.performerId === 'performer-2') {
            return Promise.reject(new Error('not found'));
          }
          return Promise.resolve({
            total: 1,
            scenes: [buildCandidate({ id: 'surviving-scene' })],
          });
        });
      sceneStatusService.resolveForScenes = jest
        .fn()
        .mockResolvedValue(new Map([['surviving-scene', { state: 'AVAILABLE' }]]));

      const result = await service.getSimilarScenes('stashdb-scene-1');

      expect(result.items.map((item) => item.id)).toEqual(['surviving-scene']);
    });

    it('caps the rail at the requested limit', async () => {
      catalogAdapter.getSceneById = jest.fn().mockResolvedValue({
        ...sceneDetails,
        performers: [
          { id: 'performer-1', name: 'A', gender: 'FEMALE', isFavorite: false, imageUrl: null },
        ],
      });
      const scenes = Array.from({ length: 5 }, (_, index) =>
        buildCandidate({ id: `scene-${index}`, releaseDate: `2026-01-0${index + 1}` }),
      );
      catalogAdapter.getScenesForPerformer = jest
        .fn()
        .mockResolvedValue({ total: scenes.length, scenes });
      sceneStatusService.resolveForScenes = jest
        .fn()
        .mockResolvedValue(
          new Map(scenes.map((scene) => [scene.id, { state: 'AVAILABLE' }])),
        );

      const result = await service.getSimilarScenes('stashdb-scene-1', 2);

      expect(result.items).toHaveLength(2);
      // Newest first.
      expect(result.items.map((item) => item.id)).toEqual(['scene-4', 'scene-3']);
    });
  });

  describe('getSceneStreamUrl', () => {
    const copies = [
      {
        id: '3027',
        width: 3840,
        height: 2160,
        viewUrl: 'http://stash.local/scene/3027',
        label: '2160p',
        duration: 600,
        resumeSeconds: 120,
      },
      {
        id: '3030',
        width: 1920,
        height: 1080,
        viewUrl: 'http://stash.local/scene/3030',
        label: '1080p',
        duration: 600,
        resumeSeconds: 0,
      },
    ];

    beforeEach(() => {
      stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue(copies);
    });

    it('resolves the best available copy when no copyId is given', async () => {
      await expect(
        service.getSceneStreamUrl('stashdb-scene-1'),
      ).resolves.toEqual({
        streamUrl: '/api/media/stash/scenes/3027/stream',
        stashSceneId: '3027',
        resumeSeconds: 120,
        duration: 600,
      });

      expect(stashAdapter.findScenesByStashId).toHaveBeenCalledWith('stashdb-scene-1', {
        baseUrl: stashIntegration.baseUrl,
        apiKey: stashIntegration.apiKey,
      });
    });

    it('resolves a specific copy when copyId is given', async () => {
      await expect(
        service.getSceneStreamUrl('stashdb-scene-1', '3030'),
      ).resolves.toEqual({
        streamUrl: '/api/media/stash/scenes/3030/stream',
        stashSceneId: '3030',
        resumeSeconds: 0,
        duration: 600,
      });
    });

    it('throws not found when no stash copy matches', async () => {
      stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([]);

      await expect(
        service.getSceneStreamUrl('stashdb-scene-1'),
      ).rejects.toThrow('No linked Stash scene found for playback.');
    });

    it('throws not found when the requested copyId does not match any copy', async () => {
      await expect(
        service.getSceneStreamUrl('stashdb-scene-1', 'missing'),
      ).rejects.toThrow('No linked Stash scene found for playback.');
    });

    it('throws not found when stash is not configured', async () => {
      integrationsService.findOne = jest.fn().mockResolvedValue({
        enabled: false,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://stash.local',
        apiKey: 'stash-key',
      });

      await expect(
        service.getSceneStreamUrl('stashdb-scene-1'),
      ).rejects.toThrow('Stash integration is not configured.');
    });
  });
  it("TPDB Popular shows the website's popular scenes, or latest releases flagged when they aren't available", async () => {
    const scene = (id: string) => ({
      id,
      title: id,
      details: null,
      imageUrl: null,
      studioId: null,
      studioName: null,
      studioImageUrl: null,
      date: null,
      releaseDate: null,
      productionDate: null,
      duration: null,
      isFromExcludedNetwork: false,
    });
    appSettingsService.get = jest.fn().mockResolvedValue({ hideAmateurNetworkResults: false });
    catalogProviderService.getConfiguredCatalogProvider = jest.fn().mockResolvedValue({
      integrationType: 'TPDB',
      providerKey: 'TPDB',
      label: 'ThePornDB',
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'tpdb-token',
    });
    const getScenesBySort = jest.fn().mockResolvedValue({
      total: 2,
      scenes: [scene('latest-1'), scene('latest-2')],
    });
    catalogProviderService.getConfiguredCatalogAdapter = jest.fn().mockResolvedValue({ getScenesBySort });
    sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(new Map());

    (tpdbWebService.getPopularScenes as jest.Mock).mockResolvedValue([scene('popular-1'), scene('popular-2')]);
    const popular = await service.getScenesFeed(1, 10, 'TRENDING');
    expect(popular.items.map((item) => item.id)).toEqual(['popular-1', 'popular-2']);
    expect(popular.hasMore).toBe(false);
    expect(popular.popularUnavailable).toBeUndefined();
    expect(getScenesBySort).not.toHaveBeenCalled();

    (tpdbWebService.getPopularScenes as jest.Mock).mockResolvedValue([]);
    const fallback = await service.getScenesFeed(1, 10, 'TRENDING');
    expect(fallback.items.map((item) => item.id)).toEqual(['latest-1', 'latest-2']);
    expect(fallback.popularUnavailable).toBe(true);

    // Latest / searched feeds don't use the popular list.
    (tpdbWebService.getPopularScenes as jest.Mock).mockClear();
    await service.getScenesFeed(1, 10, 'DATE');
    await service.getScenesFeed(1, 10, 'TRENDING', 'DESC', [], 'OR', undefined, [], 'anal');
    expect(tpdbWebService.getPopularScenes).not.toHaveBeenCalled();
  });
});
