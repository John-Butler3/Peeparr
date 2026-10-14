import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { RuntimeHealthService } from '../../runtime-health/runtime-health.service';
import { TpdbAdapter } from './tpdb.adapter';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('TpdbAdapter', () => {
  let adapter: TpdbAdapter;
  let runtimeHealthService: {
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };
  let originalFetch: typeof fetch;
  const fetchMock = jest.fn();
  const config = { baseUrl: 'https://api.theporndb.net', apiKey: 'tpdb-token' };

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    runtimeHealthService = {
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    adapter = new TpdbAdapter(runtimeHealthService as unknown as RuntimeHealthService);
  });

  it('sends a Bearer token and records runtime health on a successful connection check', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    await adapter.testConnection(config);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.theporndb.net/scenes?per_page=1'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tpdb-token' }),
      }),
    );
    expect(runtimeHealthService.recordSuccess).toHaveBeenCalled();
  });

  it('rejects an invalid token with a BadGatewayException', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthenticated.' }));

    await expect(adapter.probeConnection(config)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('retries once on a 429 before succeeding', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

    await adapter.testConnection(config);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a scenes feed page into the shared StashdbTrendingScenesResult shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 'scene-uuid-1',
            title: 'A Scene',
            description: 'desc',
            date: '2026-03-01',
            duration: 600,
            poster: 'http://cdn.local/poster.jpg',
            site_id: 42,
            site: { id: 42, name: 'Studio Name', logo: 'http://cdn.local/logo.png' },
          },
        ],
        meta: { current_page: 1, last_page: 3, total: 55 },
      }),
    );

    const result = await adapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: 20,
      sort: 'DATE',
      titleQuery: 'test',
    });

    expect(result.total).toBe(55);
    expect(result.scenes).toEqual([
      {
        id: 'scene-uuid-1',
        title: 'A Scene',
        details: 'desc',
        imageUrl: 'http://cdn.local/poster.jpg',
        studioId: '42',
        studioName: 'Studio Name',
        studioImageUrl: 'http://cdn.local/logo.png',
        date: '2026-03-01',
        releaseDate: '2026-03-01',
        productionDate: null,
        duration: 600,
        isFromExcludedNetwork: false,
      },
    ]);

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('/scenes?');
    expect(requestedUrl).toContain('q=test');
    // Searches keep TPDB's relevance order; `sort` is ignored by TPDB.
    expect(requestedUrl).not.toContain('orderBy=');
    expect(requestedUrl).not.toContain('sort=');
  });

  it('falls back to the bare site_id when a scenes feed entry has no embedded site object', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 'scene-uuid-1',
            title: 'A Scene',
            description: 'desc',
            date: '2026-03-01',
            duration: 600,
            poster: 'http://cdn.local/poster.jpg',
            site_id: 42,
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    );

    const result = await adapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: 20,
      sort: 'DATE',
    });

    expect(result.scenes[0].studioId).toBe('42');
    expect(result.scenes[0].studioName).toBeNull();
    expect(result.scenes[0].studioImageUrl).toBeNull();
    // The browse feed lists new releases (not newly added uploads).
    expect(fetchMock.mock.calls[0][0] as string).toContain('orderBy=recently_released');
  });

  it('flags a scene from a known amateur/creator network as excludable', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 'scene-uuid-1',
            title: 'A Scene',
            date: '2026-03-01',
            duration: 174,
            site_id: 115452,
            url: 'https://www.manyvids.com/Video/7767007/a-scene',
            site: {
              id: 115452,
              name: 'Manyvids: Rubyyinthewild',
              short_name: 'manyvidsrubyyinthewild',
              network: { id: 5502, name: 'ManyVids', short_name: 'manyvids' },
            },
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    );

    const result = await adapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: 20,
      sort: 'DATE',
    });

    expect(result.scenes[0].isFromExcludedNetwork).toBe(true);
  });

  it('flags a scene by its bare URL when no network object is embedded', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 'scene-uuid-1',
            title: 'A Scene',
            date: '2026-03-01',
            duration: 174,
            site_id: 115452,
            url: 'https://fansdb.example.com/video/1',
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    );

    const result = await adapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: 20,
      sort: 'DATE',
    });

    expect(result.scenes[0].isFromExcludedNetwork).toBe(true);
  });

  it('does not flag a scene from an unrelated studio', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: 'scene-uuid-1',
            title: 'A Scene',
            date: '2026-03-01',
            duration: 174,
            site_id: 1,
            url: 'https://example-studio.com/scenes/1',
            site: {
              id: 1,
              name: 'Example Studio',
              network: { id: 2, name: 'Example Network' },
            },
          },
        ],
        meta: { current_page: 1, last_page: 1, total: 1 },
      }),
    );

    const result = await adapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: 20,
      sort: 'DATE',
    });

    expect(result.scenes[0].isFromExcludedNetwork).toBe(false);
  });

  it('maps a single scene, placing the TPDB id in both stashId and tpdbId slots', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'scene-uuid-1',
          title: 'A Scene',
          description: 'desc',
          date: '2026-03-01',
          duration: 600,
          poster: 'http://cdn.local/poster.jpg',
          site: { id: 42, name: 'Studio Name', logo: 'http://cdn.local/logo.png' },
          performers: [
            {
              id: 'performer-uuid-1',
              name: 'Performer One',
              extra: { gender: 'Female' },
              image: 'http://cdn.local/performer.jpg',
            },
          ],
          tags: [{ id: 5, name: 'Tag One' }],
          url: 'https://example.com/scene',
        },
      }),
    );

    const scene = await adapter.getSceneById('scene-uuid-1', config);

    expect(scene.id).toBe('scene-uuid-1');
    expect(scene.studioId).toBe('42');
    expect(scene.studioName).toBe('Studio Name');
    expect(scene.tags).toEqual([{ id: '5', name: 'Tag One', description: null }]);
    expect(scene.performers).toEqual([
      {
        id: 'performer-uuid-1',
        name: 'Performer One',
        gender: 'FEMALE',
        isFavorite: false,
        imageUrl: 'http://cdn.local/performer.jpg',
      },
    ]);
    expect(scene.sourceUrls).toEqual([{ url: 'https://example.com/scene', type: null }]);
  });

  it('prefers the landscape background for scene.imageUrl and tags the poster with its known portrait dimensions', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'scene-uuid-1',
          title: 'A Scene',
          description: null,
          date: null,
          duration: null,
          poster: 'http://cdn.local/poster.jpg',
          background: { full: 'http://cdn.local/background.jpg' },
          performers: [],
          tags: [],
          url: null,
        },
      }),
    );

    const scene = await adapter.getSceneById('scene-uuid-1', config);

    expect(scene.imageUrl).toBe('http://cdn.local/background.jpg');
    expect(scene.images).toEqual([
      { id: 'background', url: 'http://cdn.local/background.jpg', width: null, height: null },
      { id: 'poster', url: 'http://cdn.local/poster.jpg', width: 800, height: 1200 },
    ]);
  });

  it('falls back to the generic image field with unknown dimensions when there is no dedicated poster', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'scene-uuid-1',
          title: 'A Scene',
          description: null,
          date: null,
          duration: null,
          image: 'http://cdn.local/fallback.jpg',
          performers: [],
          tags: [],
          url: null,
        },
      }),
    );

    const scene = await adapter.getSceneById('scene-uuid-1', config);

    expect(scene.images).toEqual([
      { id: 'poster', url: 'http://cdn.local/fallback.jpg', width: null, height: null },
    ]);
  });

  it('prefers a scene performer\'s parent id over its site-specific id, since only the parent id is independently fetchable', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'scene-uuid-1',
          title: 'A Scene',
          description: 'desc',
          date: '2026-03-01',
          duration: 600,
          performers: [
            {
              // Confirmed live against TPDB: this site-specific id 404s when
              // fetched directly via GET /performers/{id}.
              id: 'site-performer-uuid',
              name: 'Cassandra Cruz',
              extra: { gender: 'Female' },
              image: 'http://cdn.local/site-performer.jpg',
              parent: {
                id: 'parent-performer-uuid',
                name: 'Cassandra Cruz',
                extras: { gender: 'Female' },
                image: 'http://cdn.local/parent-performer.jpg',
              },
            },
          ],
          tags: [],
          url: null,
        },
      }),
    );

    const scene = await adapter.getSceneById('scene-uuid-1', config);

    expect(scene.performers).toEqual([
      {
        id: 'parent-performer-uuid',
        name: 'Cassandra Cruz',
        gender: 'FEMALE',
        isFavorite: false,
        imageUrl: 'http://cdn.local/parent-performer.jpg',
      },
    ]);
  });

  it('throws NotFoundException when a scene does not exist', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Not Found' }));

    await expect(adapter.getSceneById('missing', config)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps performer details from TPDB extras', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'performer-uuid-1',
          name: 'Performer One',
          aliases: ['Alias'],
          extras: {
            gender: 'Female',
            birthday: '1995-01-01',
            ethnicity: 'Caucasian',
            nationality: 'US',
            eye_colour: 'Blue',
            hair_colour: 'Blonde',
            cupsize: 'C',
            waist: 26,
            hips: 36,
            fake_boobs: false,
            career_start_year: 2015,
          },
          image: 'http://cdn.local/performer.jpg',
        },
      }),
    );

    const performer = await adapter.getPerformerById('performer-uuid-1', config);

    expect(performer).toMatchObject({
      id: 'performer-uuid-1',
      name: 'Performer One',
      gender: 'FEMALE',
      ethnicity: 'Caucasian',
      country: 'US',
      eyeColor: 'Blue',
      hairColor: 'Blonde',
      cupSize: 'C',
      waistSize: 26,
      hipSize: 36,
      breastType: 'Natural',
      careerStartYear: 2015,
      isFavorite: false,
      deleted: false,
    });
  });

  it('includes the posters gallery (sorted by order) alongside image/thumbnail/face', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: 'performer-uuid-1',
          name: 'Performer One',
          image: 'http://cdn.local/image.jpg',
          thumbnail: 'http://cdn.local/thumbnail.jpg',
          face: 'http://cdn.local/face.jpg',
          posters: [
            { id: 'p2', url: 'http://cdn.local/poster-2.jpg', size: 200, order: 2 },
            { id: 'p1', url: 'http://cdn.local/poster-1.jpg', size: 100, order: 1 },
            // Duplicate of the already-captured `image` URL -- must be
            // deduped, not listed twice.
            { id: 'p0', url: 'http://cdn.local/image.jpg', size: 50, order: 0 },
          ],
        },
      }),
    );

    const performer = await adapter.getPerformerById('performer-uuid-1', config);

    expect(performer.images).toEqual([
      { id: 'image', url: 'http://cdn.local/image.jpg', width: null, height: null },
      { id: 'thumbnail', url: 'http://cdn.local/thumbnail.jpg', width: null, height: null },
      { id: 'face', url: 'http://cdn.local/face.jpg', width: null, height: null },
      { id: 'poster-p1', url: 'http://cdn.local/poster-1.jpg', width: null, height: null },
      { id: 'poster-p2', url: 'http://cdn.local/poster-2.jpg', width: null, height: null },
    ]);
  });

  it('resolves a performer scenes feed via the numeric performer id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { id: 'performer-uuid-1', _id: 999 } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              id: 'scene-uuid-2',
              title: 'Scene Two',
              date: null,
              duration: null,
            },
          ],
          meta: { current_page: 1, last_page: 1, total: 1 },
        }),
      );

    const result = await adapter.getScenesForPerformer({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      performerId: 'performer-uuid-1',
      page: 1,
      perPage: 20,
      sort: 'DATE',
    });

    expect(result.total).toBe(1);
    expect(result.scenes[0].id).toBe('scene-uuid-2');

    const scenesUrl = fetchMock.mock.calls[1][0] as string;
    expect(scenesUrl).toContain('performer_id=999');
  });

  it('favorites a performer via the TPDB GraphQL endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { favoritePerformer: true } }),
    );

    await expect(
      adapter.favoritePerformer('performer-uuid-1', true, config),
    ).resolves.toEqual({ favorited: true, alreadyFavorited: false });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.theporndb.net/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tpdb-token',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"id":"performer-uuid-1"'),
      }),
    );
  });

  it('favorites a studio via the TPDB GraphQL endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { favoriteStudio: true } }),
    );

    await expect(
      adapter.favoriteStudio('studio-uuid-1', true, config),
    ).resolves.toEqual({ favorited: true, alreadyFavorited: false });
  });

  it('treats a duplicate-favorite GraphQL error as already favorited', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        errors: [
          {
            message:
              'duplicate key value violates unique constraint "performer_favorites_pk"',
            path: ['favoritePerformer'],
          },
        ],
      }),
    );

    await expect(
      adapter.favoritePerformer('performer-uuid-1', true, config),
    ).resolves.toEqual({ favorited: true, alreadyFavorited: true });
  });

  it('surfaces a non-duplicate GraphQL error as a BadGatewayException', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        errors: [{ message: 'Unauthenticated.' }],
      }),
    );

    await expect(
      adapter.favoritePerformer('performer-uuid-1', true, config),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
