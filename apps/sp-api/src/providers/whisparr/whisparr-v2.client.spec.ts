import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeHealthService } from '../../runtime-health/runtime-health.service';
import { WhisparrV2Client } from './whisparr-v2.client';
import { WhisparrAdapter, WhisparrCreateMovieInput } from './whisparr.adapter';

const W = 'http://whisparr.test';
const config = { baseUrl: W, apiKey: 'key' };
const UUID = 'b15edadd-d5ab-4e70-84f0-43c1290478d3';

const input: WhisparrCreateMovieInput = {
  title: 'Holly Hotwife And Her Baby Sitter',
  studioTitle: 'Brazzers',
  foreignId: UUID,
  itemType: 'Scene',
  monitored: true,
  rootFolderPath: '/data',
  addOptions: { searchForMovie: true },
  qualityProfileId: 1,
  tags: [],
};

const series = {
  id: 7,
  tvdbId: 92,
  title: 'Brazzers',
  titleSlug: 'brazzers',
  monitored: true,
};
const episode = (overrides: Record<string, unknown> = {}) => ({
  id: 259,
  seriesId: 7,
  tvdbId: 857622,
  episodeFileId: 0,
  title: 'Holly Hotwife And Her Baby Sitter',
  overview: null,
  releaseDate: '2020-09-22',
  runtime: 36,
  monitored: false,
  hasFile: false,
  ...overrides,
});

type Route = (method: string, url: string, body: unknown) => unknown;

// A fake Whisparr v2, ThePornDB and Whisparr metadata service behind fetch.
function serve(route: Route) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: String(url), body });
    const result = route(method, String(url), body);
    if (result === 404) {
      return new Response('', { status: 404 });
    }
    return new Response(result === undefined ? '' : JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

const tpdb = (method: string, url: string) =>
  method === 'GET' && url === `https://tpdb.test/scenes/${UUID}`
    ? { data: { id: UUID, _id: 857622, site: { id: 92, name: 'Brazzers' } } }
    : undefined;

describe('WhisparrV2Client', () => {
  const originalFetch = global.fetch;
  let client: WhisparrV2Client;

  beforeEach(() => {
    const prisma = {
      integrationConfig: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          baseUrl: 'https://tpdb.test',
          apiKey: 'tpdb-key',
        }),
      },
    } as unknown as PrismaService;
    client = new WhisparrV2Client(prisma);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('adds the site with nothing monitored, then monitors and searches just this scene', async () => {
    let added = false;
    const calls = serve((method, url, body) => {
      const known = tpdb(method, url);
      if (known) return known;
      if (url === `${W}/api/v3/series?tvdbId=92`) return added ? [series] : [];
      if (url === `${W}/api/v3/series/lookup?term=tpdb%3A92`)
        return [{ tvdbId: 92, title: 'Brazzers' }];
      if (method === 'POST' && url === `${W}/api/v3/series`) {
        added = true;
        return { ...series, ...(body as object) };
      }
      if (url === `${W}/api/v3/episode?seriesId=7`)
        return [episode({ id: 258, tvdbId: 1 }), episode()];
      if (url === `${W}/api/v3/episode/monitor`) return [];
      if (url === `${W}/api/v3/command`) return { name: 'EpisodeSearch' };
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(client.create(input, config)).resolves.toEqual({
      movieId: 259,
    });

    const add = calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/series'),
    );
    expect(add?.body).toMatchObject({
      tvdbId: 92,
      qualityProfileId: 1,
      rootFolderPath: '/data',
      monitored: true,
      monitorNewItems: 'none',
      addOptions: { monitor: 'none', searchForMissingEpisodes: false },
    });
    expect(
      calls.find((call) => call.url.endsWith('/episode/monitor'))?.body,
    ).toEqual({
      episodeIds: [259],
      monitored: true,
    });
    expect(calls.find((call) => call.url.endsWith('/command'))?.body).toEqual({
      name: 'EpisodeSearch',
      episodeIds: [259],
    });
  });

  it('refuses scenes ThePornDB does not know (another catalog)', async () => {
    serve(() => 404);
    await expect(client.create(input, config)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('only counts a scene as requested once it is monitored or downloaded', async () => {
    let monitored = false;
    serve((method, url) => {
      const known = tpdb(method, url);
      if (known) return known;
      if (url === `${W}/api/v3/series?tvdbId=92`) return [series];
      if (url === `${W}/api/v3/episode?seriesId=7`)
        return [episode({ monitored })];
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(client.findByStashId(UUID, config)).resolves.toBeNull();
    monitored = true;
    await expect(client.findByStashId(UUID, config)).resolves.toMatchObject({
      movieId: 259,
      stashId: UUID,
      hasFile: false,
      cachedStudioId: '92',
      cachedStudioName: 'Brazzers',
      cachedReleaseDate: '2020-09-22',
      cachedDurationSeconds: 2160,
    });
  });

  it('lists requested scenes with their ThePornDB ids from the metadata service', async () => {
    serve((method, url) => {
      if (url === `${W}/api/v3/series`) return [series];
      if (url === `${W}/api/v3/episode?seriesId=7`)
        return [episode({ hasFile: true }), episode({ id: 300, tvdbId: 5 })];
      if (url === `${WhisparrV2Client.METADATA_URL}/scene/857622`)
        return { ForeignGuid: UUID };
      throw new Error(`unexpected ${method} ${url}`);
    });

    const snapshot = await client.snapshot(config);
    expect(snapshot.map((entry) => [entry.movieId, entry.stashId])).toEqual([
      [259, UUID],
    ]);
  });

  it('removing unmonitors the scene and deletes its file when asked', async () => {
    const calls = serve((method, url) => {
      if (url === `${W}/api/v3/episode/259`)
        return episode({ monitored: true, hasFile: true, episodeFileId: 41 });
      if (url === `${W}/api/v3/episode/monitor`) return [];
      if (method === 'DELETE' && url === `${W}/api/v3/episodefile/41`)
        return undefined;
      throw new Error(`unexpected ${method} ${url}`);
    });

    await client.remove(259, config, { deleteFiles: true });
    expect(
      calls.map((call) => `${call.method} ${call.url.replace(W, '')}`),
    ).toEqual([
      'GET /api/v3/episode/259',
      'PUT /api/v3/episode/monitor',
      'DELETE /api/v3/episodefile/41',
    ]);
  });
});

describe('WhisparrAdapter with Whisparr v2', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends requests to the v2 client when the instance reports a 2.x version', async () => {
    serve((method, url) => {
      if (url === `${W}/api/v3/system/status`) return { version: '2.2.0.231' };
      throw new Error(`unexpected ${method} ${url}`);
    });
    const v2 = {
      create: jest.fn().mockResolvedValue({ movieId: 259 }),
    } as unknown as WhisparrV2Client;
    const runtimeHealth = {
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as RuntimeHealthService;
    const adapter = new WhisparrAdapter(runtimeHealth, v2);

    await expect(adapter.createMovie(input, config)).resolves.toEqual({
      movieId: 259,
    });
    expect(v2.create).toHaveBeenCalledWith(input, config);
  });

  it('keeps using the Eros API for 3.x', async () => {
    serve((method, url) => {
      if (url === `${W}/api/v3/system/status`) return { version: '3.0.1.1234' };
      if (method === 'POST' && url === `${W}/api/v3/movie`) return { id: 12 };
      throw new Error(`unexpected ${method} ${url}`);
    });
    const v2 = { create: jest.fn() } as unknown as WhisparrV2Client;
    const runtimeHealth = {
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as RuntimeHealthService;
    const adapter = new WhisparrAdapter(runtimeHealth, v2);

    await expect(adapter.createMovie(input, config)).resolves.toEqual({
      movieId: 12,
    });
    expect(v2.create).not.toHaveBeenCalled();
  });
});
