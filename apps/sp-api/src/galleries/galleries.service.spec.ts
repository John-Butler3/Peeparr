import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { GalleriesService } from './galleries.service';

describe('GalleriesService', () => {
  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  const stashAdapter = {
    getLocalGalleryFeed: jest.fn(),
    getGalleryById: jest.fn(),
    getGalleryImages: jest.fn(),
    searchTags: jest.fn(),
    searchStudios: jest.fn(),
  } as unknown as StashAdapter;

  const stashIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stash.local',
    apiKey: 'stash-key',
  };

  const galleryFixture = {
    id: 'gallery-1',
    title: 'Gallery One',
    description: 'Details',
    coverImageUrl: 'http://stash.local/cover.jpg?apikey=stash-key',
    studioId: 'studio-1',
    studio: 'Studio',
    studioImageUrl: 'http://stash.local/studio.jpg?apikey=stash-key',
    performers: [{ id: 'p-1', name: 'Performer One', imageUrl: null }],
    tagIds: ['tag-1'],
    tagNames: ['Tag One'],
    imageCount: 42,
    releaseDate: '2026-01-01',
    viewUrl: 'http://stash.local/galleries/gallery-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  let service: GalleriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GalleriesService(integrationsService, stashAdapter);

    integrationsService.findOne = jest.fn().mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.STASH) {
        return stashIntegration;
      }
      throw new Error('Unexpected integration type');
    });

    stashAdapter.getLocalGalleryFeed = jest.fn().mockResolvedValue({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [galleryFixture],
    });
    stashAdapter.getGalleryById = jest.fn().mockResolvedValue(galleryFixture);
    stashAdapter.getGalleryImages = jest.fn().mockResolvedValue({
      total: 2,
      page: 1,
      perPage: 40,
      hasMore: false,
      items: [
        {
          id: 'image-1',
          title: null,
          imageUrl: 'http://stash.local/image-1.jpg',
          thumbnailUrl: 'http://stash.local/image-1-thumb.jpg',
          width: 1920,
          height: 1080,
        },
      ],
    });
    stashAdapter.searchTags = jest
      .fn()
      .mockResolvedValue([{ id: 'tag-1', name: 'Tag One' }]);
    stashAdapter.searchStudios = jest
      .fn()
      .mockResolvedValue([{ id: 'studio-1', name: 'Studio', childStudios: [] }]);
  });

  it('returns a galleries feed sourced from the local Stash instance', async () => {
    await expect(service.getGalleriesFeed()).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
      hasMore: false,
      items: [
        {
          id: 'gallery-1',
          title: 'Gallery One',
          description: 'Details',
          coverImageUrl: '/api/media/stash/galleries/gallery-1/cover',
          studioId: null,
          studio: 'Studio',
          studioImageUrl: '/api/media/stash/studios/studio-1/logo',
          performers: [{ id: 'p-1', name: 'Performer One', imageUrl: null }],
          tagIds: ['tag-1'],
          tagNames: ['Tag One'],
          imageCount: 42,
          releaseDate: '2026-01-01',
          viewUrl: 'http://stash.local/galleries/gallery-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    expect(stashAdapter.getLocalGalleryFeed).toHaveBeenCalledWith(
      { baseUrl: stashIntegration.baseUrl, apiKey: stashIntegration.apiKey },
      { page: 1, perPage: 24, titleQuery: undefined, tagIds: [], studioIds: [] },
    );
  });

  it('forwards search query and tag/studio filters', async () => {
    await service.getGalleriesFeed(2, 12, {
      query: 'beach',
      tagIds: ['tag-1', 'tag-1'],
      studioIds: ['studio-1'],
    });

    expect(stashAdapter.getLocalGalleryFeed).toHaveBeenCalledWith(
      { baseUrl: stashIntegration.baseUrl, apiKey: stashIntegration.apiKey },
      {
        page: 2,
        perPage: 12,
        titleQuery: 'beach',
        tagIds: ['tag-1'],
        studioIds: ['studio-1'],
      },
    );
  });

  it('throws when Stash is not configured', async () => {
    integrationsService.findOne = jest.fn().mockResolvedValue({
      enabled: false,
      status: IntegrationStatus.NOT_CONFIGURED,
      baseUrl: null,
      apiKey: null,
    });

    await expect(service.getGalleriesFeed()).rejects.toThrow(
      'Stash integration is not configured.',
    );
  });

  it('returns a single gallery by id', async () => {
    await expect(service.getGalleryById('gallery-1')).resolves.toMatchObject({
      id: 'gallery-1',
      title: 'Gallery One',
    });
  });

  it('throws a NotFoundException when the gallery does not exist', async () => {
    stashAdapter.getGalleryById = jest.fn().mockResolvedValue(null);

    await expect(service.getGalleryById('missing')).rejects.toThrow(
      'Gallery missing not found.',
    );
  });

  it('returns paginated images for a gallery, proxied through this app rather than Stash directly', async () => {
    await expect(service.getGalleryImages('gallery-1', 1, 40)).resolves.toEqual({
      total: 2,
      page: 1,
      perPage: 40,
      hasMore: false,
      items: [
        {
          id: 'image-1',
          title: null,
          imageUrl: '/api/media/stash/images/image-1/full',
          thumbnailUrl: '/api/media/stash/images/image-1/thumbnail',
          width: 1920,
          height: 1080,
        },
      ],
    });
    expect(stashAdapter.getGalleryImages).toHaveBeenCalledWith(
      'gallery-1',
      { baseUrl: stashIntegration.baseUrl, apiKey: stashIntegration.apiKey },
      { page: 1, perPage: 40 },
    );
  });

  it('proxies a gallery performer photo when one exists', async () => {
    stashAdapter.getGalleryById = jest.fn().mockResolvedValue({
      ...galleryFixture,
      performers: [
        { id: 'p-1', name: 'Performer One', imageUrl: 'http://stash.local/p-1.jpg' },
      ],
    });

    await expect(service.getGalleryById('gallery-1')).resolves.toMatchObject({
      performers: [
        { id: 'p-1', name: 'Performer One', imageUrl: '/api/media/stash/performers/p-1/photo' },
      ],
    });
  });

  it('omits the cover/studio image URL when the source gallery has none', async () => {
    stashAdapter.getGalleryById = jest.fn().mockResolvedValue({
      ...galleryFixture,
      coverImageUrl: null,
      studioId: null,
      studioImageUrl: null,
    });

    await expect(service.getGalleryById('gallery-1')).resolves.toMatchObject({
      coverImageUrl: null,
      studioImageUrl: null,
    });
  });

  it('searches tags, mapped down to id/name', async () => {
    await expect(service.searchTags('tag')).resolves.toEqual([
      { id: 'tag-1', name: 'Tag One' },
    ]);
  });

  it('returns an empty array for a blank tag query without calling Stash', async () => {
    await expect(service.searchTags('  ')).resolves.toEqual([]);
    expect(stashAdapter.searchTags).not.toHaveBeenCalled();
  });

  it('searches studios, mapped down to id/name', async () => {
    await expect(service.searchStudios('stu')).resolves.toEqual([
      { id: 'studio-1', name: 'Studio' },
    ]);
  });
});
