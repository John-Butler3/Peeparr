import { NotFoundException } from '@nestjs/common';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { CatalogAdapter } from '../providers/catalog/catalog-adapter.interface';
import { StudiosService } from './studios.service';

describe('StudiosService', () => {
  const catalogProviderService = {
    getConfiguredCatalogProvider: jest.fn(),
    getConfiguredCatalogAdapter: jest.fn(),
  } as unknown as CatalogProviderService;

  const catalogAdapter = {
    getStudiosFeed: jest.fn(),
    getStudioById: jest.fn(),
  } as unknown as CatalogAdapter;

  const stashdbIntegration = {
    integrationType: 'STASHDB',
    providerKey: 'STASHDB',
    label: 'StashDB',
    baseUrl: 'http://stashdb.local/graphql',
    apiKey: 'stashdb-key',
  };

  let service: StudiosService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StudiosService(catalogProviderService);

    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue(stashdbIntegration);
    catalogProviderService.getConfiguredCatalogAdapter = jest
      .fn()
      .mockResolvedValue(catalogAdapter);

    catalogAdapter.getStudiosFeed = jest.fn().mockResolvedValue({
      total: 1,
      studios: [
        {
          id: 'studio-1',
          name: 'Studio One',
          isFavorite: true,
          imageUrl: 'http://studio-image',
          parentStudio: null,
          childStudios: [{ id: 'child-1', name: 'Studio Child' }],
        },
      ],
    });
    catalogAdapter.getStudioById = jest.fn().mockResolvedValue({
      id: 'studio-1',
      name: 'Studio One',
      aliases: ['Alias One'],
      deleted: false,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-02-01',
      imageUrl: 'http://studio-image',
      images: [
        {
          id: 'img-1',
          url: 'http://studio-image',
          width: 400,
          height: 220,
        },
      ],
      urls: [
        {
          url: 'https://stashdb.org/studios/studio-1',
          type: 'DETAILS',
          siteName: 'StashDB',
          siteUrl: 'https://stashdb.org',
          siteIcon: null,
        },
      ],
      parentStudio: {
        id: 'parent-1',
        name: 'Parent Studio',
        aliases: ['Parent Alias'],
        isFavorite: false,
        urls: [],
      },
      childStudios: [
        {
          id: 'child-1',
          name: 'Child Studio',
          aliases: [],
          deleted: false,
          isFavorite: false,
          createdAt: null,
          updatedAt: null,
          imageUrl: null,
        },
      ],
    });
  });

  it('uses default query behavior for studios feed', async () => {
    await expect(service.getStudiosFeed()).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [
        {
          id: 'studio-1',
          name: 'Studio One',
          isFavorite: true,
          imageUrl: 'http://studio-image',
          parentStudio: null,
          childStudios: [{ id: 'child-1', name: 'Studio Child' }],
        },
      ],
    });

    expect(catalogAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 24,
      name: undefined,
      sort: 'NAME',
      direction: 'ASC',
      favoritesOnly: false,
    });
  });

  it('forwards selected studios filters to the catalog adapter', async () => {
    await service.getStudiosFeed(2, 25, {
      name: 'brazz',
      sort: 'UPDATED_AT',
      favoritesOnly: true,
    });

    expect(catalogAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 2,
      perPage: 25,
      name: 'brazz',
      sort: 'UPDATED_AT',
      direction: 'ASC',
      favoritesOnly: true,
    });
  });

  it('forwards explicit studios feed direction', async () => {
    await service.getStudiosFeed(1, 50, {
      sort: 'NAME',
      direction: 'DESC',
    });

    expect(catalogAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 50,
      name: undefined,
      sort: 'NAME',
      direction: 'DESC',
      favoritesOnly: false,
    });
  });

  it('uses the active FANSDB provider for studio discovery', async () => {
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'FANSDB',
        providerKey: 'FANSDB',
        label: 'FansDB',
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      });

    await service.getStudiosFeed();

    expect(catalogAdapter.getStudiosFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://fansdb.local/graphql',
        apiKey: 'fansdb-key',
      }),
    );
  });

  it('uses the TPDB catalog adapter when TPDB is the active provider', async () => {
    catalogProviderService.getConfiguredCatalogProvider = jest
      .fn()
      .mockResolvedValue({
        integrationType: 'TPDB',
        providerKey: 'TPDB',
        label: 'ThePornDB',
        baseUrl: 'https://api.theporndb.net',
        apiKey: 'tpdb-token',
      });

    await service.getStudiosFeed();

    expect(catalogProviderService.getConfiguredCatalogAdapter).toHaveBeenCalled();
    expect(catalogAdapter.getStudiosFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.theporndb.net',
        apiKey: 'tpdb-token',
      }),
    );
  });

  it('returns normalized studio details by id', async () => {
    await expect(service.getStudioById('studio-1')).resolves.toEqual({
      id: 'studio-1',
      name: 'Studio One',
      aliases: ['Alias One'],
      deleted: false,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-02-01',
      imageUrl: 'http://studio-image',
      images: [
        {
          id: 'img-1',
          url: 'http://studio-image',
          width: 400,
          height: 220,
        },
      ],
      urls: [
        {
          url: 'https://stashdb.org/studios/studio-1',
          type: 'DETAILS',
          siteName: 'StashDB',
          siteUrl: 'https://stashdb.org',
          siteIcon: null,
        },
      ],
      parentStudio: {
        id: 'parent-1',
        name: 'Parent Studio',
        aliases: ['Parent Alias'],
        isFavorite: false,
        urls: [],
      },
      childStudios: [
        {
          id: 'child-1',
          name: 'Child Studio',
          aliases: [],
          deleted: false,
          isFavorite: false,
          createdAt: null,
          updatedAt: null,
          imageUrl: null,
        },
      ],
    });

    expect(catalogAdapter.getStudioById).toHaveBeenCalledWith('studio-1', {
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
    });
  });

  it('rejects studio details fetch when id is empty', async () => {
    await expect(service.getStudioById('   ')).rejects.toThrow(
      'Studio id is required.',
    );
  });

  it('propagates not-found when studio details are missing', async () => {
    catalogAdapter.getStudioById = jest
      .fn()
      .mockRejectedValue(new NotFoundException('missing'));

    await expect(service.getStudioById('studio-404')).rejects.toThrow(
      NotFoundException,
    );
  });
});
