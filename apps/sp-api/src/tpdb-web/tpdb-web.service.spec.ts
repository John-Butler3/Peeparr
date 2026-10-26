/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { PrismaService } from '../prisma/prisma.service';
import { TpdbAdapter } from '../providers/tpdb/tpdb.adapter';
import { TpdbWebService } from './tpdb-web.service';

// A pretend theporndb.net: Inertia pages (JSON in a data-page script), a
// session cookie set by signing in, and a members-only homepage.
function page(component: string, props: Record<string, unknown>, url: string) {
  const json = JSON.stringify({ component, props, url, version: 'v1' });
  return `<html><body><script data-page="app" type="application/json">${json}</script></body></html>`;
}

function fakeSite(options: {
  password: string;
  home?: Record<string, unknown>;
}) {
  const calls: string[] = [];
  const fetchMock = jest.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const cookie = (init.headers as Record<string, string>)?.Cookie ?? '';
    const signedIn = cookie.includes('session=member');
    calls.push(`${init.method ?? 'GET'} ${url.pathname}`);
    const respond = (
      status: number,
      body: string,
      headers: Record<string, string> = {},
      cookies: string[] = [],
    ) => {
      const h = new Headers(headers);
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: Object.assign(h, { getSetCookie: () => cookies }),
        text: async () => body,
      } as unknown as Response;
    };

    if (url.pathname === '/login' && init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (
        body.password !== options.password ||
        !(init.headers as Record<string, string>)['X-XSRF-TOKEN']
      ) {
        return respond(302, '', { location: 'https://theporndb.net/login' });
      }
      return respond(302, '', { location: 'https://theporndb.net/' }, [
        'session=member; path=/',
      ]);
    }
    if (url.pathname === '/login') {
      return respond(
        200,
        page(
          'Auth/Login',
          {
            errors: cookie.includes('xsrf')
              ? { email: 'These credentials do not match our records.' }
              : {},
          },
          '/login',
        ),
        {},
        ['XSRF-TOKEN=tok%3D; path=/', 'session=guest; path=/'],
      );
    }
    if (['/', '/performers', '/sites'].includes(url.pathname) && !signedIn) {
      return respond(302, '', { location: 'https://theporndb.net/login' });
    }
    if (url.pathname === '/sites') {
      // The website's sites page: its list, in its own (popular) order.
      return respond(
        200,
        page(
          'Sites/Index',
          {
            sites: {
              data: [1, 2, 3].map((n) => ({
                uuid: `site-${n}`,
                id: n,
                name: `Site ${n}`,
              })),
            },
          },
          '/sites',
        ),
      );
    }
    if (url.pathname === '/performers') {
      // The website's performers page: its list, in its own (popular) order.
      return respond(
        200,
        page(
          'Performers/Index',
          {
            performers: {
              data: [1, 2, 3].map((n) => ({
                uuid: `performer-${n}`,
                id: n,
                name: `Performer ${n}`,
              })),
            },
          },
          '/performers',
        ),
      );
    }
    return respond(
      200,
      page(
        'Home',
        options.home ?? {
          latestPerformers: [{ id: 1, name: 'P' }],
          recentScenes: [1, 2, 3].map((n) => ({
            uuid: `recent-${n}`,
            title: `Recent ${n}`,
          })),
          popularScenes: [1, 2, 3, 4].map((n) => ({
            uuid: `popular-${n}`,
            id: 900 + n,
            title: `Popular ${n}`,
            // Each scene's own cast: not a list of popular performers.
            performers: [1, 2, 3].map((p) => ({
              uuid: `cast-${n}-${p}`,
              name: `Cast ${p}`,
            })),
          })),
        },
        '/',
      ),
    );
  });
  return { fetchMock, calls };
}

describe('TpdbWebService', () => {
  let row: Record<string, any> | null;
  let service: TpdbWebService;
  let tpdbAdapter: {
    getFeedSceneById: jest.Mock;
    getFeedPerformerById: jest.Mock;
    getFeedStudioById: jest.Mock;
    getPerformersFeed: jest.Mock;
    getStudiosFeed: jest.Mock;
  };

  beforeEach(() => {
    row = null;
    const prisma = {
      tpdbWebAccount: {
        findUnique: jest.fn(async () => (row ? { ...row } : null)),
        upsert: jest.fn(async ({ create, update }) => {
          row = row
            ? { ...row, ...update }
            : {
                popularSceneIds: [],
                popularPerformerIds: [],
                popularSiteIds: [],
                sessionCookies: null,
                ...create,
              };
          return row;
        }),
        update: jest.fn(async ({ data }) => {
          row = { ...row, ...data };
          return row;
        }),
        deleteMany: jest.fn(async () => {
          row = null;
        }),
      },
    } as unknown as PrismaService;
    tpdbAdapter = {
      getFeedSceneById: jest.fn(async (id: string) => ({
        id,
        title: id,
        isFromExcludedNetwork: false,
        // Who's in each popular scene, and its site.
        ...{
          'popular-1': { performerIds: ['p-a', 'p-b'], studioId: 's-1' },
          'popular-2': { performerIds: ['p-c'], studioId: 's-2' },
          'popular-3': { performerIds: ['p-b', 'p-a'], studioId: 's-1' },
          'popular-4': { performerIds: ['p-a'], studioId: 's-1' },
        }[id],
      })),
      getFeedPerformerById: jest.fn(async (id: string) => ({
        id,
        name: { 'main-a': 'A', 'main-b': 'B', 'main-c': 'C' }[id] ?? id,
      })),
      getPerformersFeed: jest.fn(async () => ({ total: 0, performers: [] })),
      getStudiosFeed: jest.fn(async () => ({ total: 0, studios: [] })),
      getFeedStudioById: jest.fn(async (id: string) => ({ id, name: id })),
    };
    service = new TpdbWebService(prisma, tpdbAdapter as unknown as TpdbAdapter);
  });

  afterEach(() => jest.restoreAllMocks());

  it('signs in, reads the popular list from the homepage and resolves it through the API', async () => {
    const site = fakeSite({ password: 'secret' });
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'secret');

    const scenes = await service.getPopularScenes({
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'k',
    });

    expect(scenes.map((scene) => scene.id)).toEqual([
      'popular-1',
      'popular-2',
      'popular-3',
      'popular-4',
    ]);
    expect(row?.popularSourcePath).toBe('popularScenes');
    expect(row?.lastError).toBeNull();
    expect(site.calls).toContain('POST /login');

    // Cached: no further website requests while it's fresh.
    const before = site.calls.length;
    await service.getPopularScenes({
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'k',
    });
    expect(site.calls.length).toBe(before);
  });

  it('reuses the saved session instead of signing in again', async () => {
    const site = fakeSite({ password: 'secret' });
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'secret');
    await service.refreshNow();
    site.calls.length = 0;

    await service.refreshNow();

    expect(site.calls).toEqual(['GET /']);
  });

  it("ranks popular performers and sites by the popular scenes they're in -- not a page of the newest", async () => {
    const site = fakeSite({ password: 'secret' });
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'secret');
    const api = { baseUrl: 'https://api.theporndb.net', apiKey: 'k' };

    const performers = await service.getPopularPerformers(api);
    const sites = await service.getPopularSites(api);

    // p-a is in three, p-b two, p-c one; s-1 three, s-2 one.
    expect(performers.map((performer) => performer.id)).toEqual([
      'p-a',
      'p-b',
      'p-c',
    ]);
    expect(sites.map((popular) => popular.id)).toEqual(['s-1', 's-2']);
    // Never the website's performers or sites pages (their newest first).
    expect(site.calls).not.toContain('GET /performers');
    expect(site.calls).not.toContain('GET /sites');
    const status = await service.getStatus();
    expect(status.popularPerformerCount).toBe(3);
    expect(status.popularSiteCount).toBe(2);
  });

  it("takes a homepage's top performers, a site profile as its main performer", async () => {
    const site = fakeSite({
      password: 'secret',
      home: {
        topScenes: [1, 2, 3].map((n) => ({
          uuid: `scene-${n}`,
          title: `Scene ${n}`,
        })),
        topPerformers: [
          { id: 11, name: 'Profile A', parent: { uuid: 'main-a', name: 'A' } },
          { uuid: 'main-b', name: 'B' },
          {
            id: 12,
            name: 'Profile A again',
            parent: { uuid: 'main-a', name: 'A' },
          },
          { uuid: 'main-c', name: 'C' },
        ],
      },
    });
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'secret');

    const performers = await service.getPopularPerformers({
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'k',
    });

    expect(performers.map((performer) => performer.id)).toEqual([
      'main-a',
      'main-b',
      'main-c',
    ]);
    expect(row?.popularPerformerSourcePath).toBe('/ topPerformers');
  });

  it('finds a popular performer by the name the homepage shows when its id is someone else', async () => {
    const site = fakeSite({
      password: 'secret',
      home: {
        topScenes: [1, 2, 3].map((n) => ({
          uuid: `scene-${n}`,
          title: `Scene ${n}`,
        })),
        topPerformers: [
          { id: 7, name: 'Angela White' },
          { uuid: 'main-b', name: 'B' },
          { uuid: 'main-c', name: 'C' },
        ],
      },
    });
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(site.fetchMock as unknown as typeof fetch);
    // The website's id 7 is another performer through the API.
    tpdbAdapter.getFeedPerformerById.mockImplementation(async (id: string) => ({
      id,
      name: { '7': 'Someone Else', 'main-b': 'B', 'main-c': 'C' }[id] ?? id,
    }));
    tpdbAdapter.getPerformersFeed.mockResolvedValue({
      total: 2,
      performers: [
        { id: 'angela-site', name: 'Angela White', sceneCount: 3 },
        { id: 'angela-main', name: 'Angela White', sceneCount: 900 },
      ],
    });
    await service.saveAccount('me@example.com', 'secret');

    const performers = await service.getPopularPerformers({
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'k',
    });

    expect(performers.map((performer) => performer.id)).toEqual([
      'angela-main',
      'main-b',
      'main-c',
    ]);
    expect(tpdbAdapter.getPerformersFeed).toHaveBeenCalledTimes(1);
  });

  it('records the error and returns nothing when the password is wrong', async () => {
    const site = fakeSite({ password: 'secret' });
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'wrong');

    const scenes = await service.getPopularScenes({
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'k',
    });

    expect(scenes).toEqual([]);
    expect(row?.lastError).toMatch(/sign-in failed/i);
    // Backs off: no new attempt straight away.
    const before = site.calls.length;
    await service.getPopularScenes({
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'k',
    });
    expect(site.calls.length).toBe(before);
  });

  it('does nothing without a saved login', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    expect(
      await service.getPopularScenes({ baseUrl: 'x', apiKey: null }),
    ).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
