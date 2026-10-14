import { BadRequestException } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import type { CatalogAdapter } from '../providers/catalog/catalog-adapter.interface';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AppSettingsService } from '../settings/app-settings.service';
import { PerformerFavoritesService } from './performer-favorites.service';
import { PerformerImagePreferenceService } from './performer-image-preference.service';
import { PerformersService } from './performers.service';

describe('PerformersService', () => {
  const catalogProviderService = {
    getConfiguredCatalogProvider: jest.fn(),
    getConfiguredCatalogAdapter: jest.fn(),
  } as unknown as CatalogProviderService;

  const catalogAdapter = {
    getPerformersFeed: jest.fn(),
    getPerformerById: jest.fn(),
    getScenesForPerformer: jest.fn(),
    searchStudios: jest.fn(),
    favoritePerformer: jest.fn(),
  } as unknown as CatalogAdapter;

  const sceneStatusService = {
    resolveForScenes: jest.fn(),
  } as unknown as SceneStatusService;

  const appSettingsService = {
    get: jest.fn(),
  } as unknown as AppSettingsService;

  const performerFavoritesService = {
    isFavorite: jest.fn(),
    getFavoriteIds: jest.fn(),
    listAllFavoriteIds: jest.fn(),
    setFavorite: jest.fn(),
  } as unknown as PerformerFavoritesService;

  const performerImagePreferenceService = {
    getMainImageUrl: jest.fn(),
    getMainImageUrls: jest.fn(),
    setMainImage: jest.fn(),
  } as unknown as PerformerImagePreferenceService;

  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  const stashAdapter = {
    findPerformerByStashId: jest.fn(),
    setPerformerFavorite: jest.fn(),
  } as unknown as StashAdapter;

  const stashdbIntegration = {
    integrationType: 'STASHDB',
    providerKey: 'STASHDB',
    label: 'StashDB',
    baseUrl: 'http://stashdb.local/graphql',
    apiKey: 'stashdb-key',
  };

  const stashIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stash.local',
    apiKey: 'stash-key',
  };

  let service: PerformersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PerformersService(
      catalogProviderService,
      sceneStatusService,
      appSettingsService,
      performerFavoritesService,
      performerImagePreferenceService,
      integrationsService,
      stashAdapter,
    );

    performerImagePreferenceService.getMainImageUrl = jest.fn().mockResolvedValue(null);
    performerImagePreferenceService.getMainImageUrls = jest.fn().mockResolvedValue(new Map());

    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue(stashdbIntegration);
    catalogProviderService.getConfiguredCatalogAdapter = jest
      .fn()
      .mockResolvedValue(catalogAdapter);

    catalogAdapter.getPerformersFeed = jest.fn().mockResolvedValue({
      total: 1,
      performers: [
        {
          id: 'p-1',
          name: 'Performer One',
          gender: 'FEMALE',
          sceneCount: 12,
          isFavorite: true,
          imageUrl: 'http://cdn.local/performer.jpg',
        },
      ],
    });
    catalogAdapter.getPerformerById = jest.fn().mockResolvedValue({
      id: 'p-1',
      name: 'Performer One',
      disambiguation: null,
      aliases: ['Alias'],
      gender: 'FEMALE',
      birthDate: '1990-01-01',
      deathDate: null,
      age: 35,
      ethnicity: 'Ethnicity',
      country: 'US',
      eyeColor: 'Brown',
      hairColor: 'Black',
      height: '170cm',
      cupSize: null,
      bandSize: null,
      waistSize: null,
      hipSize: null,
      breastType: null,
      careerStartYear: 2010,
      careerEndYear: null,
      deleted: false,
      mergedIds: [],
      mergedIntoId: null,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2025-01-01',
      imageUrl: null,
      images: [],
    });
    catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
      total: 1,
      scenes: [
        {
          id: 'scene-1',
          title: 'Scene One',
          details: 'Details',
          imageUrl: 'http://cdn.local/scene.jpg',
          studioId: 'studio-1',
          studioName: 'Studio',
          studioImageUrl: 'http://studio-image',
          date: '2026-03-01',
          releaseDate: '2026-03-02',
          productionDate: null,
          duration: 420,
        },
      ],
    });
    catalogAdapter.searchStudios = jest.fn().mockResolvedValue([
      {
        id: 'studio-1',
        name: 'Studio',
        childStudios: [{ id: 'studio-1a', name: 'Studio Child' }],
      },
    ]);
    catalogAdapter.favoritePerformer = jest.fn().mockResolvedValue({
      favorited: true,
      alreadyFavorited: false,
    });
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(new Map([['scene-1', { state: 'AVAILABLE' }]]));
    appSettingsService.get = jest
      .fn()
      .mockResolvedValue({ hideAmateurNetworkResults: false });
    performerFavoritesService.isFavorite = jest.fn().mockResolvedValue(true);
    performerFavoritesService.getFavoriteIds = jest
      .fn()
      .mockResolvedValue(new Set(['p-1']));
    performerFavoritesService.listAllFavoriteIds = jest
      .fn()
      .mockResolvedValue(['p-1']);
    performerFavoritesService.setFavorite = jest
      .fn()
      .mockResolvedValue({ favorited: true, alreadyFavorited: false });
    integrationsService.findOne = jest.fn().mockResolvedValue(stashIntegration);
    stashAdapter.findPerformerByStashId = jest.fn().mockResolvedValue(null);
    stashAdapter.setPerformerFavorite = jest.fn().mockResolvedValue(undefined);
  });

  it('uses default query behavior for performers feed', async () => {
    await expect(service.getPerformersFeed()).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [
        {
          id: 'p-1',
          name: 'Performer One',
          gender: 'FEMALE',
          sceneCount: 12,
          isFavorite: true,
          imageUrl: 'http://cdn.local/performer.jpg',
          cardImageUrl: 'http://cdn.local/performer.jpg?size=300',
        },
      ],
    });

    expect(catalogAdapter.getPerformersFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 24,
      name: undefined,
      gender: undefined,
      sort: 'NAME',
      direction: 'ASC',
      favoritesOnly: false,
    });
  });

  it('applies a saved main-image override to feed items', async () => {
    performerImagePreferenceService.getMainImageUrls = jest
      .fn()
      .mockResolvedValue(new Map([['p-1', 'http://cdn.local/chosen.jpg']]));

    const result = await service.getPerformersFeed();

    expect(result.items[0]).toMatchObject({
      id: 'p-1',
      imageUrl: 'http://cdn.local/chosen.jpg',
      cardImageUrl: 'http://cdn.local/chosen.jpg?size=300',
    });
    expect(performerImagePreferenceService.getMainImageUrls).toHaveBeenCalledWith(['p-1']);
  });

  it('forwards all filters to stashdb adapter', async () => {
    await service.getPerformersFeed(2, 25, {
      name: 'aj',
      gender: 'FEMALE',
      sort: 'SCENE_COUNT',
      favoritesOnly: false,
    });

    expect(catalogAdapter.getPerformersFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 2,
      perPage: 25,
      name: 'aj',
      gender: 'FEMALE',
      sort: 'SCENE_COUNT',
      direction: 'ASC',
      favoritesOnly: false,
    });
  });

  it('overrides isFavorite with locally-tracked state, ignoring the provider value', async () => {
    performerFavoritesService.getFavoriteIds = jest.fn().mockResolvedValue(new Set());

    await expect(service.getPerformersFeed()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'p-1', isFavorite: false })],
    });
    expect(performerFavoritesService.getFavoriteIds).toHaveBeenCalledWith(['p-1']);
  });

  it('bypasses the provider feed entirely and serves favorites from local storage', async () => {
    performerFavoritesService.listAllFavoriteIds = jest
      .fn()
      .mockResolvedValue(['p-1', 'p-2']);
    catalogAdapter.getPerformerById = jest.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        name: id === 'p-1' ? 'Aaron' : 'Zoe',
        disambiguation: null,
        aliases: [],
        gender: 'FEMALE',
        birthDate: null,
        deathDate: null,
        age: null,
        ethnicity: null,
        country: null,
        eyeColor: null,
        hairColor: null,
        height: null,
        cupSize: null,
        bandSize: null,
        waistSize: null,
        hipSize: null,
        breastType: null,
        careerStartYear: null,
        careerEndYear: null,
        deleted: false,
        mergedIds: [],
        mergedIntoId: null,
        isFavorite: false,
        createdAt: null,
        updatedAt: null,
        imageUrl: null,
        images: [],
      }),
    );

    const result = await service.getPerformersFeed(1, 24, { favoritesOnly: true });

    expect(catalogAdapter.getPerformersFeed).not.toHaveBeenCalled();
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(['p-1', 'p-2']);
    expect(result.items.every((item) => item.isFavorite)).toBe(true);
  });

  it('applies a saved main-image override to the favorites feed when still valid', async () => {
    performerFavoritesService.listAllFavoriteIds = jest.fn().mockResolvedValue(['p-1']);
    catalogAdapter.getPerformerById = jest.fn().mockResolvedValue({
      id: 'p-1',
      name: 'Aaron',
      disambiguation: null,
      aliases: [],
      gender: 'FEMALE',
      birthDate: null,
      deathDate: null,
      age: null,
      ethnicity: null,
      country: null,
      eyeColor: null,
      hairColor: null,
      height: null,
      cupSize: null,
      bandSize: null,
      waistSize: null,
      hipSize: null,
      breastType: null,
      careerStartYear: null,
      careerEndYear: null,
      deleted: false,
      mergedIds: [],
      mergedIntoId: null,
      isFavorite: false,
      createdAt: null,
      updatedAt: null,
      imageUrl: 'http://cdn.local/default.jpg',
      images: [
        { id: 'image', url: 'http://cdn.local/default.jpg', width: null, height: null },
        { id: 'poster-1', url: 'http://cdn.local/chosen.jpg', width: null, height: null },
      ],
    });
    performerImagePreferenceService.getMainImageUrls = jest
      .fn()
      .mockResolvedValue(new Map([['p-1', 'http://cdn.local/chosen.jpg']]));

    const result = await service.getPerformersFeed(1, 24, { favoritesOnly: true });

    expect(result.items[0]).toMatchObject({
      imageUrl: 'http://cdn.local/chosen.jpg',
      cardImageUrl: 'http://cdn.local/chosen.jpg?size=300',
    });
  });

  it('drops a favorited performer that no longer resolves upstream instead of failing the feed', async () => {
    performerFavoritesService.listAllFavoriteIds = jest
      .fn()
      .mockResolvedValue(['p-1', 'deleted-performer']);
    catalogAdapter.getPerformerById = jest.fn().mockImplementation((id: string) => {
      if (id === 'deleted-performer') {
        return Promise.reject(new Error('not found'));
      }
      return Promise.resolve({
        id,
        name: 'Performer One',
        disambiguation: null,
        aliases: [],
        gender: 'FEMALE',
        birthDate: null,
        deathDate: null,
        age: null,
        ethnicity: null,
        country: null,
        eyeColor: null,
        hairColor: null,
        height: null,
        cupSize: null,
        bandSize: null,
        waistSize: null,
        hipSize: null,
        breastType: null,
        careerStartYear: null,
        careerEndYear: null,
        deleted: false,
        mergedIds: [],
        mergedIntoId: null,
        isFavorite: false,
        createdAt: null,
        updatedAt: null,
        imageUrl: null,
        images: [],
      });
    });

    const result = await service.getPerformersFeed(1, 24, { favoritesOnly: true });

    expect(result.items.map((item) => item.id)).toEqual(['p-1']);
  });

  it('forwards explicit performer feed sort direction', async () => {
    await service.getPerformersFeed(1, 50, {
      sort: 'NAME',
      direction: 'DESC',
    });

    expect(catalogAdapter.getPerformersFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 50,
      name: undefined,
      gender: undefined,
      sort: 'NAME',
      direction: 'DESC',
      favoritesOnly: false,
    });
  });

  it('returns normalized performer details', async () => {
    await expect(service.getPerformerById('p-1')).resolves.toMatchObject({
      id: 'p-1',
      name: 'Performer One',
      gender: 'FEMALE',
      isFavorite: true,
    });
  });

  it('uses a saved main-image override when it is still one of the current images', async () => {
    catalogAdapter.getPerformerById = jest.fn().mockResolvedValue({
      id: 'p-1',
      name: 'Performer One',
      imageUrl: 'http://cdn.local/image.jpg',
      images: [
        { id: 'image', url: 'http://cdn.local/image.jpg', width: null, height: null },
        { id: 'poster-1', url: 'http://cdn.local/poster-1.jpg', width: null, height: null },
      ],
      isFavorite: false,
      deleted: false,
      mergedIds: [],
    });
    performerImagePreferenceService.getMainImageUrl = jest
      .fn()
      .mockResolvedValue('http://cdn.local/poster-1.jpg');

    const result = await service.getPerformerById('p-1');

    expect(result.imageUrl).toBe('http://cdn.local/poster-1.jpg');
  });

  it('falls back to the provider default when a saved override is no longer among the images', async () => {
    catalogAdapter.getPerformerById = jest.fn().mockResolvedValue({
      id: 'p-1',
      name: 'Performer One',
      imageUrl: 'http://cdn.local/image.jpg',
      images: [{ id: 'image', url: 'http://cdn.local/image.jpg', width: null, height: null }],
      isFavorite: false,
      deleted: false,
      mergedIds: [],
    });
    performerImagePreferenceService.getMainImageUrl = jest
      .fn()
      .mockResolvedValue('http://cdn.local/stale-poster.jpg');

    const result = await service.getPerformerById('p-1');

    expect(result.imageUrl).toBe('http://cdn.local/image.jpg');
  });

  it('saves a main-image override after validating it against the current images', async () => {
    catalogAdapter.getPerformerById = jest.fn().mockResolvedValue({
      id: 'p-1',
      name: 'Performer One',
      imageUrl: 'http://cdn.local/image.jpg',
      images: [
        { id: 'image', url: 'http://cdn.local/image.jpg', width: null, height: null },
        { id: 'poster-1', url: 'http://cdn.local/poster-1.jpg', width: null, height: null },
      ],
      isFavorite: false,
      deleted: false,
      mergedIds: [],
    });

    await service.setMainPerformerImage('p-1', 'http://cdn.local/poster-1.jpg');

    expect(performerImagePreferenceService.setMainImage).toHaveBeenCalledWith(
      'p-1',
      'http://cdn.local/poster-1.jpg',
    );
  });

  it('rejects a main-image override that is not one of the current images', async () => {
    catalogAdapter.getPerformerById = jest.fn().mockResolvedValue({
      id: 'p-1',
      name: 'Performer One',
      imageUrl: 'http://cdn.local/image.jpg',
      images: [{ id: 'image', url: 'http://cdn.local/image.jpg', width: null, height: null }],
      isFavorite: false,
      deleted: false,
      mergedIds: [],
    });

    await expect(
      service.setMainPerformerImage('p-1', 'http://cdn.local/not-real.jpg'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(performerImagePreferenceService.setMainImage).not.toHaveBeenCalled();
  });

  it('returns performer-scoped scenes with DATE default sort', async () => {
    await expect(service.getPerformerScenes('p-1')).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [
        {
          id: 'scene-1',
          title: 'Scene One',
          description: 'Details',
          imageUrl: 'http://cdn.local/scene.jpg',
          cardImageUrl: 'http://cdn.local/scene.jpg?size=600',
          studioId: 'studio-1',
          studio: 'Studio',
          studioImageUrl: 'http://studio-image',
          releaseDate: '2026-03-02',
          duration: 420,
          type: 'SCENE',
          source: 'STASHDB',
          status: { state: 'AVAILABLE' },
        },
      ],
    });

    expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      performerId: 'p-1',
      page: 1,
      perPage: 24,
      sort: 'DATE',
      direction: 'DESC',
      studioIds: [],
      tagIds: [],
      onlyFavoriteStudios: false,
    });
  });

  it('hides a non-library excluded-network scene when hideAmateurNetworkResults is on', async () => {
    appSettingsService.get = jest
      .fn()
      .mockResolvedValue({ hideAmateurNetworkResults: true });
    catalogAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
      total: 2,
      scenes: [
        {
          id: 'scene-1',
          title: 'Scene One',
          details: 'Details',
          imageUrl: 'http://cdn.local/scene.jpg',
          studioId: 'studio-1',
          studioName: 'Studio',
          studioImageUrl: 'http://studio-image',
          date: '2026-03-01',
          releaseDate: '2026-03-02',
          productionDate: null,
          duration: 420,
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
    sceneStatusService.resolveForScenes = jest.fn().mockResolvedValue(
      new Map([
        ['scene-1', { state: 'AVAILABLE' }],
        ['amateur-scene-1', { state: 'NOT_REQUESTED' }],
      ]),
    );

    const result = await service.getPerformerScenes('p-1');

    expect(result.items.map((item) => item.id)).toEqual(['scene-1']);
  });

  it('forwards performer-scoped scene filters', async () => {
    await service.getPerformerScenes('p-1', 2, 20, {
      sort: 'UPDATED_AT',
      studioIds: ['studio-1', 'studio-1'],
      tagIds: ['tag-1'],
      onlyFavoriteStudios: true,
    });

    expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      performerId: 'p-1',
      page: 2,
      perPage: 20,
      sort: 'UPDATED_AT',
      direction: 'DESC',
      studioIds: ['studio-1'],
      tagIds: ['tag-1'],
      onlyFavoriteStudios: true,
    });
  });

  it('forwards explicit performer-scenes sort direction', async () => {
    await service.getPerformerScenes('p-1', 1, 25, {
      sort: 'DATE',
      direction: 'ASC',
    });

    expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      performerId: 'p-1',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'ASC',
      studioIds: [],
      tagIds: [],
      onlyFavoriteStudios: false,
    });
  });

  it('uses the active FANSDB provider for performer scenes', async () => {
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'FANSDB',
        providerKey: 'FANSDB',
        label: 'FansDB',
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      });

    await expect(service.getPerformerScenes('p-1')).resolves.toMatchObject({
      items: [expect.objectContaining({ source: 'FANSDB' })],
    });

    expect(catalogAdapter.getScenesForPerformer).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      }),
    );
  });

  it('searches studios from stashdb', async () => {
    await expect(service.searchStudios('team')).resolves.toEqual([
      {
        id: 'studio-1',
        name: 'Studio',
        childStudios: [{ id: 'studio-1a', name: 'Studio Child' }],
      },
    ]);
  });

  it('favorites performer by id', async () => {
    await expect(service.favoritePerformer('p-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });

    expect(performerFavoritesService.setFavorite).toHaveBeenCalledWith('p-1', true);
    expect(catalogAdapter.favoritePerformer).toHaveBeenCalledWith(
      'p-1',
      true,
      {
        baseUrl: stashdbIntegration.baseUrl,
        apiKey: stashdbIntegration.apiKey,
      },
    );
  });

  it('keeps the local favorite even when the provider mutation is a no-op or fails (e.g. TPDB)', async () => {
    catalogAdapter.favoritePerformer = jest
      .fn()
      .mockRejectedValue(new Error('TPDB does not actually persist this'));

    await expect(service.favoritePerformer('p-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });

    expect(performerFavoritesService.setFavorite).toHaveBeenCalledWith('p-1', true);
  });

  it('mirrors the favorite into a matching local Stash performer', async () => {
    stashAdapter.findPerformerByStashId = jest
      .fn()
      .mockResolvedValue({ id: 'local-performer-1', favorite: false });

    await service.favoritePerformer('p-1', true);

    expect(stashAdapter.findPerformerByStashId).toHaveBeenCalledWith('p-1', {
      baseUrl: stashIntegration.baseUrl,
      apiKey: stashIntegration.apiKey,
    });
    expect(stashAdapter.setPerformerFavorite).toHaveBeenCalledWith(
      'local-performer-1',
      true,
      { baseUrl: stashIntegration.baseUrl, apiKey: stashIntegration.apiKey },
    );
  });

  it('does not touch Stash when no local performer is matched yet', async () => {
    await service.favoritePerformer('p-1', true);

    expect(stashAdapter.findPerformerByStashId).toHaveBeenCalled();
    expect(stashAdapter.setPerformerFavorite).not.toHaveBeenCalled();
  });

  it('skips the Stash sync when Stash is not configured, without failing the toggle', async () => {
    integrationsService.findOne = jest.fn().mockResolvedValue({
      enabled: false,
      status: IntegrationStatus.NOT_CONFIGURED,
      baseUrl: null,
      apiKey: null,
    });

    await expect(service.favoritePerformer('p-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });
    expect(stashAdapter.findPerformerByStashId).not.toHaveBeenCalled();
  });

  it('keeps the local favorite even when the Stash sync throws', async () => {
    stashAdapter.findPerformerByStashId = jest
      .fn()
      .mockRejectedValue(new Error('Stash unreachable'));

    await expect(service.favoritePerformer('p-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });
  });

  it('favorites a performer through whichever catalog adapter is configured (e.g. TPDB)', async () => {
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

    await expect(service.favoritePerformer('p-1', true)).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });
    expect(catalogAdapter.favoritePerformer).toHaveBeenCalledWith('p-1', true, {
      baseUrl: tpdbProvider.baseUrl,
      apiKey: tpdbProvider.apiKey,
    });
  });
});
