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

function fakeSite(options: { password: string }) {
  const calls: string[] = [];
  const fetchMock = jest.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const cookie = (init.headers as Record<string, string>)?.Cookie ?? '';
    const signedIn = cookie.includes('session=member');
    calls.push(`${init.method ?? 'GET'} ${url.pathname}`);
    const respond = (status: number, body: string, headers: Record<string, string> = {}, cookies: string[] = []) => {
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
      if (body.password !== options.password || !(init.headers as Record<string, string>)['X-XSRF-TOKEN']) {
        return respond(302, '', { location: 'https://theporndb.net/login' });
      }
      return respond(302, '', { location: 'https://theporndb.net/' }, ['session=member; path=/']);
    }
    if (url.pathname === '/login') {
      return respond(200, page('Auth/Login', { errors: cookie.includes('xsrf') ? { email: 'These credentials do not match our records.' } : {} }, '/login'), {}, [
        'XSRF-TOKEN=tok%3D; path=/',
        'session=guest; path=/',
      ]);
    }
    if (url.pathname === '/' && !signedIn) {
      return respond(302, '', { location: 'https://theporndb.net/login' });
    }
    return respond(
      200,
      page(
        'Home',
        {
          latestPerformers: [{ id: 1, name: 'P' }],
          recentScenes: [1, 2, 3].map((n) => ({ uuid: `recent-${n}`, title: `Recent ${n}` })),
          popularScenes: [1, 2, 3, 4].map((n) => ({ uuid: `popular-${n}`, id: 900 + n, title: `Popular ${n}` })),
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
  let tpdbAdapter: { getFeedSceneById: jest.Mock };

  beforeEach(() => {
    row = null;
    const prisma = {
      tpdbWebAccount: {
        findUnique: jest.fn(async () => (row ? { ...row } : null)),
        upsert: jest.fn(async ({ create, update }) => {
          row = row ? { ...row, ...update } : { popularSceneIds: [], sessionCookies: null, ...create };
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
      getFeedSceneById: jest.fn(async (id: string) => ({ id, title: id, isFromExcludedNetwork: false })),
    };
    service = new TpdbWebService(prisma, tpdbAdapter as unknown as TpdbAdapter);
  });

  afterEach(() => jest.restoreAllMocks());

  it('signs in, reads the popular list from the homepage and resolves it through the API', async () => {
    const site = fakeSite({ password: 'secret' });
    jest.spyOn(global, 'fetch').mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'secret');

    const scenes = await service.getPopularScenes({ baseUrl: 'https://api.theporndb.net', apiKey: 'k' });

    expect(scenes.map((scene) => scene.id)).toEqual(['popular-1', 'popular-2', 'popular-3', 'popular-4']);
    expect(row?.popularSourcePath).toBe('popularScenes');
    expect(row?.lastError).toBeNull();
    expect(site.calls).toContain('POST /login');

    // Cached: no further website requests while it's fresh.
    const before = site.calls.length;
    await service.getPopularScenes({ baseUrl: 'https://api.theporndb.net', apiKey: 'k' });
    expect(site.calls.length).toBe(before);
  });

  it('reuses the saved session instead of signing in again', async () => {
    const site = fakeSite({ password: 'secret' });
    jest.spyOn(global, 'fetch').mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'secret');
    await service.refreshNow();
    site.calls.length = 0;

    await service.refreshNow();

    expect(site.calls).toEqual(['GET /']);
  });

  it('records the error and returns nothing when the password is wrong', async () => {
    const site = fakeSite({ password: 'secret' });
    jest.spyOn(global, 'fetch').mockImplementation(site.fetchMock as unknown as typeof fetch);
    await service.saveAccount('me@example.com', 'wrong');

    const scenes = await service.getPopularScenes({ baseUrl: 'https://api.theporndb.net', apiKey: 'k' });

    expect(scenes).toEqual([]);
    expect(row?.lastError).toMatch(/sign-in failed/i);
    // Backs off: no new attempt straight away.
    const before = site.calls.length;
    await service.getPopularScenes({ baseUrl: 'https://api.theporndb.net', apiKey: 'k' });
    expect(site.calls.length).toBe(before);
  });

  it('does nothing without a saved login', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    expect(await service.getPopularScenes({ baseUrl: 'x', apiKey: null })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
