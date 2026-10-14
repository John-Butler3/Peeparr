import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { TpdbAdapter } from '../providers/tpdb/tpdb.adapter';
import { WhisparrMetadataService } from './whisparr-metadata.service';

describe('WhisparrMetadataService', () => {
  const findOneMock = jest.fn();
  const getSceneByIdMock = jest.fn();
  const getScenesBySortMock = jest.fn();
  const getPerformerByIdMock = jest.fn();
  const getPerformersFeedMock = jest.fn();
  const getStudioByIdMock = jest.fn();
  const sceneIndexFindUniqueMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const tpdbAdapter = {
    getSceneById: getSceneByIdMock,
    getScenesBySort: getScenesBySortMock,
    getPerformerById: getPerformerByIdMock,
    getPerformersFeed: getPerformersFeedMock,
    getStudioById: getStudioByIdMock,
  } as unknown as TpdbAdapter;

  const prisma = {
    sceneIndex: {
      findUnique: sceneIndexFindUniqueMock,
    },
  } as unknown as PrismaService;

  let service: WhisparrMetadataService;

  const tpdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'https://api.theporndb.net',
    apiKey: 'tpdb-token',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhisparrMetadataService(
      integrationsService,
      tpdbAdapter,
      prisma,
    );
    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.TPDB) {
        return tpdbIntegration;
      }
      throw new Error('Unexpected integration type');
    });
    sceneIndexFindUniqueMock.mockResolvedValue(null);
  });

  it('throws ServiceUnavailableException when TPDB is not configured', async () => {
    findOneMock.mockResolvedValue({
      enabled: false,
      status: IntegrationStatus.NOT_CONFIGURED,
      baseUrl: null,
      apiKey: null,
    });

    await expect(service.searchScenes('test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('places the TPDB scene id in both the stashId and tpdbId slots when mapping a scene', async () => {
    getSceneByIdMock.mockResolvedValue({
      id: 'tpdb-scene-uuid',
      title: 'A Scene',
      details: 'desc',
      imageUrl: 'http://cdn.local/poster.jpg',
      studioId: 'tpdb-studio-uuid',
      studioName: 'Studio Name',
      studioImageUrl: 'http://cdn.local/logo.png',
      releaseDate: '2026-03-01',
      duration: 600,
      images: [{ id: 'poster', url: 'http://cdn.local/poster.jpg', width: null, height: null }],
      studioIsFavorite: false,
      tags: [{ id: 't1', name: 'Tag', description: null }],
      performers: [
        {
          id: 'tpdb-performer-uuid',
          name: 'Performer One',
          gender: 'FEMALE',
          isFavorite: false,
          imageUrl: 'http://cdn.local/performer.jpg',
        },
      ],
      sourceUrls: [{ url: 'https://theporndb.net/scenes/tpdb-scene-uuid', type: null }],
    });

    const resource = (await service.getScene('tpdb-scene-uuid')) as {
      foreignIds: { stashId: string; tpdbId: string; tmdbId: number };
      itemType: string;
      studio: { foreignIds: { stashId: string; tpdbId: string } } | null;
      credits: Array<{ performer: { foreignIds: { stashId: string; tpdbId: string } } }>;
    };

    expect(resource.foreignIds).toEqual({
      stashId: 'tpdb-scene-uuid',
      tpdbId: 'tpdb-scene-uuid',
      tmdbId: 0,
    });
    expect(resource.itemType).toBe('scene');
    expect(resource.studio?.foreignIds).toEqual({
      stashId: 'tpdb-studio-uuid',
      tpdbId: 'tpdb-studio-uuid',
      tmdbId: 0,
    });
    expect(resource.credits[0].performer.foreignIds).toEqual({
      stashId: 'tpdb-performer-uuid',
      tpdbId: 'tpdb-performer-uuid',
      tmdbId: 0,
    });

    expect(getSceneByIdMock).toHaveBeenCalledWith('tpdb-scene-uuid', {
      baseUrl: tpdbIntegration.baseUrl,
      apiKey: tpdbIntegration.apiKey,
    });
  });

  it('omits the studio when a scene has no studio metadata, rather than failing the lookup', async () => {
    getSceneByIdMock.mockResolvedValue({
      id: 'tpdb-scene-uuid',
      title: 'A Scene',
      details: null,
      imageUrl: null,
      studioId: null,
      studioName: null,
      studioImageUrl: null,
      releaseDate: null,
      duration: null,
      images: [],
      studioIsFavorite: false,
      tags: [],
      performers: [],
      sourceUrls: [],
    });

    const resource = (await service.getScene('tpdb-scene-uuid')) as { studio: unknown };

    expect(resource.studio).toBeNull();
  });

  it('falls back to the locally cached SceneIndex row when TPDB no longer recognizes an id, so Whisparr can re-link an existing library folder', async () => {
    getSceneByIdMock.mockRejectedValue(new NotFoundException('TPDB resource not found.'));
    sceneIndexFindUniqueMock.mockResolvedValue({
      stashId: 'old-stashdb-scene-uuid',
      title: 'Cached Title',
      description: 'Cached description',
      imageUrl: 'http://cdn.local/cached-image.jpg',
      studioId: 'cached-studio-id',
      studioName: 'Cached Studio',
      studioImageUrl: 'http://cdn.local/cached-studio.jpg',
      releaseDate: '2026-01-01',
      duration: 900,
    });

    const resource = (await service.getScene('old-stashdb-scene-uuid')) as {
      title: string;
      foreignIds: { stashId: string };
      studio: { title: string } | null;
    };

    expect(resource.title).toBe('Cached Title');
    expect(resource.foreignIds.stashId).toBe('old-stashdb-scene-uuid');
    expect(resource.studio?.title).toBe('Cached Studio');
    expect(sceneIndexFindUniqueMock).toHaveBeenCalledWith({
      where: { stashId: 'old-stashdb-scene-uuid' },
    });
  });

  it('rethrows NotFoundException when neither TPDB nor the local cache has the scene', async () => {
    getSceneByIdMock.mockRejectedValue(new NotFoundException('TPDB resource not found.'));
    sceneIndexFindUniqueMock.mockResolvedValue(null);

    await expect(service.getScene('unknown-scene-uuid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rethrows NotFoundException when the cached row exists but has no title yet', async () => {
    getSceneByIdMock.mockRejectedValue(new NotFoundException('TPDB resource not found.'));
    sceneIndexFindUniqueMock.mockResolvedValue({
      stashId: 'pending-scene-uuid',
      title: null,
      description: null,
      imageUrl: null,
      studioId: null,
      studioName: null,
      studioImageUrl: null,
      releaseDate: null,
      duration: null,
    });

    await expect(service.getScene('pending-scene-uuid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('enriches scene search results with studio names, since the list endpoint only returns a studio id', async () => {
    getScenesBySortMock.mockResolvedValue({
      total: 2,
      scenes: [
        {
          id: 'scene-1',
          title: 'Scene One',
          details: null,
          imageUrl: null,
          studioId: 'studio-1',
          studioName: null,
          studioImageUrl: null,
          releaseDate: null,
          duration: null,
        },
        {
          id: 'scene-2',
          title: 'Scene Two',
          details: null,
          imageUrl: null,
          studioId: 'studio-1',
          studioName: null,
          studioImageUrl: null,
          releaseDate: null,
          duration: null,
        },
      ],
    });
    getStudioByIdMock.mockResolvedValue({
      id: 'studio-1',
      name: 'Studio One',
      aliases: [],
      deleted: false,
      isFavorite: false,
      createdAt: null,
      updatedAt: null,
      imageUrl: 'http://cdn.local/logo.png',
      images: [],
      urls: [],
      parentStudio: null,
      childStudios: [],
    });

    const results = (await service.searchScenes('test')) as Array<{
      studio: { title: string } | null;
    }>;

    expect(results).toHaveLength(2);
    expect(results[0].studio?.title).toBe('Studio One');
    expect(results[1].studio?.title).toBe('Studio One');
    // Both scenes share the same studio id — resolved once, not twice.
    expect(getStudioByIdMock).toHaveBeenCalledTimes(1);
  });

  it('does not fail the whole search when one studio lookup fails', async () => {
    getScenesBySortMock.mockResolvedValue({
      total: 1,
      scenes: [
        {
          id: 'scene-1',
          title: 'Scene One',
          details: null,
          imageUrl: null,
          studioId: 'studio-missing',
          studioName: null,
          studioImageUrl: null,
          releaseDate: null,
          duration: null,
        },
      ],
    });
    getStudioByIdMock.mockRejectedValue(new Error('not found'));

    const results = (await service.searchScenes('test')) as Array<{
      studio: unknown;
      title: string;
    }>;

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Scene One');
    expect(results[0].studio).toBeNull();
  });

  it('reports no changes for the changed-since routes', async () => {
    await expect(service.getScenesChanged()).resolves.toEqual([]);
    await expect(service.getPerformersChanged()).resolves.toEqual([]);
    await expect(service.getSitesChanged()).resolves.toEqual([]);
  });
});
