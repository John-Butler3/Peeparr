import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type TpdbWebAccount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TpdbAdapter } from '../providers/tpdb/tpdb.adapter';
import {
  type StashdbPerformerFeedItem,
  type StashdbStudioFeedItem,
  type StashdbScene,
} from '../providers/stashdb/stashdb.adapter';

type CookieJar = Record<string, string>;

interface InertiaPage {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string | null;
}

export interface TpdbWebStatus {
  configured: boolean;
  email: string | null;
  popularCount: number;
  popularPerformerCount: number;
  popularSiteCount: number;
  popularFetchedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  sourcePath: string | null;
  performerSourcePath: string | null;
  siteSourcePath: string | null;
}

/**
 * ThePornDB's "popular scenes" are only on its members' homepage (no API
 * for them). With a website login saved, this signs in (keeping the
 * session), reads the homepage's embedded page data, takes the scene ids
 * from its popular list and resolves them through the real API. Popular
 * performers and sites the same way: a list of them on the homepage, else
 * on the website's performers (sites) page.
 *
 * The website is hit rarely: the session is reused (a fresh sign-in only
 * when it has expired), the homepage at most every CACHE_TTL_MS, and after
 * a failure not again for RETRY_AFTER_FAILURE_MS. Anything going wrong just
 * means no popular list -- callers fall back to TPDB's latest releases.
 */
@Injectable()
export class TpdbWebService {
  static readonly SITE = 'https://theporndb.net';
  static readonly CACHE_TTL_MS = 3 * 60 * 60 * 1000;
  static readonly RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
  static readonly REQUEST_TIMEOUT_MS = 20_000;
  static readonly MAX_SCENES = 60;
  static readonly MAX_PERFORMERS = 60;
  static readonly MAX_SITES = 60;
  private static readonly USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

  private readonly logger = new Logger(TpdbWebService.name);
  private refreshing: Promise<void> | null = null;
  // Scenes resolved through the API for the current id list.
  private resolved: { key: string; scenes: StashdbScene[]; at: number } | null =
    null;
  // Sites resolved through the API for the current id list.
  private resolvedSites: {
    key: string;
    sites: StashdbStudioFeedItem[];
    at: number;
  } | null = null;
  // Performers resolved through the API for the current id list.
  private resolvedPerformers: {
    key: string;
    performers: StashdbPerformerFeedItem[];
    at: number;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tpdbAdapter: TpdbAdapter,
  ) {}

  async getStatus(): Promise<TpdbWebStatus> {
    const account = await this.prisma.tpdbWebAccount.findUnique({
      where: { id: 1 },
    });
    return {
      configured: !!account,
      email: account?.email ?? null,
      popularCount: account?.popularSceneIds.length ?? 0,
      // (Ranked from the popular scenes when the homepage has no list.)
      popularPerformerCount:
        (account?.popularPerformerSourcePath?.startsWith('/ ')
          ? account.popularPerformerIds?.length
          : this.resolvedPerformers?.performers.length) ?? 0,
      popularSiteCount:
        (account?.popularSiteSourcePath?.startsWith('/ ')
          ? account.popularSiteIds?.length
          : this.resolvedSites?.sites.length) ?? 0,
      popularFetchedAt: account?.popularFetchedAt?.toISOString() ?? null,
      lastAttemptAt: account?.lastAttemptAt?.toISOString() ?? null,
      lastError: account?.lastError ?? null,
      sourcePath: account?.popularSourcePath ?? null,
      performerSourcePath: account?.popularPerformerSourcePath ?? null,
      siteSourcePath: account?.popularSiteSourcePath ?? null,
    };
  }

  /** Saves the login (password kept when left blank) and forgets the old session. */
  async saveAccount(email: string, password?: string): Promise<TpdbWebStatus> {
    const trimmedEmail = email.trim();
    const existing = await this.prisma.tpdbWebAccount.findUnique({
      where: { id: 1 },
    });
    const nextPassword = password ? password : existing?.password;
    if (!trimmedEmail || !nextPassword) {
      throw new BadRequestException('Email and password are required.');
    }

    const changed = existing?.email !== trimmedEmail || !!password;
    await this.prisma.tpdbWebAccount.upsert({
      where: { id: 1 },
      create: { id: 1, email: trimmedEmail, password: nextPassword },
      update: {
        email: trimmedEmail,
        password: nextPassword,
        ...(changed
          ? {
              sessionCookies: Prisma.JsonNull,
              popularSceneIds: [],
              popularPerformerIds: [],
              popularSiteIds: [],
              popularFetchedAt: null,
              lastAttemptAt: null,
              lastError: null,
            }
          : {}),
      },
    });
    this.resolved = null;
    this.resolvedPerformers = null;
    this.resolvedSites = null;
    return this.getStatus();
  }

  async removeAccount(): Promise<void> {
    await this.prisma.tpdbWebAccount.deleteMany({});
    this.resolved = null;
    this.resolvedPerformers = null;
    this.resolvedSites = null;
  }

  /** Signs in and reads the homepage now (ignoring the cache); returns the result. */
  async refreshNow(): Promise<TpdbWebStatus> {
    const account = await this.prisma.tpdbWebAccount.findUnique({
      where: { id: 1 },
    });
    if (!account) {
      throw new BadRequestException('No TPDB website login saved.');
    }

    await this.refresh(account);
    return this.getStatus();
  }

  /**
   * The website's popular scenes, resolved through the API; empty when
   * there's no login or it isn't working. Serves the cached list straight
   * away and refreshes it in the background when it's due.
   */
  async getPopularScenes(apiConfig: {
    baseUrl: string;
    apiKey: string | null;
  }): Promise<StashdbScene[]> {
    let account = await this.prisma.tpdbWebAccount.findUnique({
      where: { id: 1 },
    });
    if (!account) {
      return [];
    }

    if (this.isDue(account)) {
      const refresh = this.refresh(account).catch(() => undefined);
      if (account.popularSceneIds.length === 0) {
        // Nothing cached yet: wait for the first fetch.
        await refresh;
        account = await this.prisma.tpdbWebAccount.findUnique({
          where: { id: 1 },
        });
        if (!account) {
          return [];
        }
      }
    }

    return this.resolveScenes(account.popularSceneIds, apiConfig);
  }

  /**
   * The website's popular performers, resolved through the API; empty when
   * there's no login, it isn't working, or the website shows none.
   */
  async getPopularPerformers(apiConfig: {
    baseUrl: string;
    apiKey: string | null;
  }): Promise<StashdbPerformerFeedItem[]> {
    let account = await this.prisma.tpdbWebAccount.findUnique({
      where: { id: 1 },
    });
    if (!account) {
      return [];
    }

    if (this.isDue(account)) {
      const refresh = this.refresh(account).catch(() => undefined);
      if (!account.popularFetchedAt) {
        // Never read yet: wait for the first fetch.
        await refresh;
        account = await this.prisma.tpdbWebAccount.findUnique({
          where: { id: 1 },
        });
        if (!account) {
          return [];
        }
      }
    }

    // (Only a homepage list: one read from the performers page, newest first, isn't.)
    const listed = account.popularPerformerSourcePath?.startsWith('/ ')
      ? (account.popularPerformerIds ?? [])
      : [];
    if (listed.length) {
      return this.resolvePerformers(
        listed,
        account.popularPerformerNames ?? [],
        apiConfig,
      );
    }
    const ranked = await this.rankFromPopularScenes(
      account.popularSceneIds,
      apiConfig,
      'performer',
    );
    return this.resolvePerformers(ranked, [], apiConfig);
  }

  /**
   * Performers (sites) ranked by how many of the popular scenes they're in;
   * ties go to the one in the more popular scene. For when the website
   * doesn't list popular ones itself.
   */
  private async rankFromPopularScenes(
    sceneIds: string[],
    apiConfig: { baseUrl: string; apiKey: string | null },
    kind: 'performer' | 'site',
  ): Promise<string[]> {
    const scenes = await this.resolveScenes(sceneIds, apiConfig);
    const tally = new Map<string, { count: number; first: number }>();
    scenes.forEach((scene, index) => {
      const ids =
        kind === 'performer'
          ? (scene.performerIds ?? [])
          : scene.studioId
            ? [scene.studioId]
            : [];
      for (const id of new Set(ids)) {
        const entry = tally.get(id);
        if (entry) {
          entry.count += 1;
        } else {
          tally.set(id, { count: 1, first: index });
        }
      }
    });
    return [...tally.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
      .slice(
        0,
        kind === 'performer'
          ? TpdbWebService.MAX_PERFORMERS
          : TpdbWebService.MAX_SITES,
      )
      .map(([id]) => id);
  }

  /**
   * The website's popular sites, resolved through the API; empty when
   * there's no login, it isn't working, or the website shows none.
   */
  async getPopularSites(apiConfig: {
    baseUrl: string;
    apiKey: string | null;
  }): Promise<StashdbStudioFeedItem[]> {
    let account = await this.prisma.tpdbWebAccount.findUnique({
      where: { id: 1 },
    });
    if (!account) {
      return [];
    }

    if (this.isDue(account)) {
      const refresh = this.refresh(account).catch(() => undefined);
      if (!account.popularFetchedAt) {
        // Never read yet: wait for the first fetch.
        await refresh;
        account = await this.prisma.tpdbWebAccount.findUnique({
          where: { id: 1 },
        });
        if (!account) {
          return [];
        }
      }
    }

    const listedSites = account.popularSiteSourcePath?.startsWith('/ ')
      ? (account.popularSiteIds ?? [])
      : [];
    const ids = listedSites.length
      ? listedSites
      : await this.rankFromPopularScenes(
          account.popularSceneIds,
          apiConfig,
          'site',
        );
    const names = listedSites.length ? (account.popularSiteNames ?? []) : [];
    const key = `${ids.join(',')}|${names.join(',')}`;
    if (!ids.length) {
      return [];
    }
    const cached = this.resolvedSites;
    if (
      cached?.key === key &&
      Date.now() - cached.at < TpdbWebService.CACHE_TTL_MS
    ) {
      return cached.sites;
    }
    const sites: StashdbStudioFeedItem[] = [];
    // A few at a time, to go easy on the API.
    for (let index = 0; index < ids.length; index += 6) {
      const batch = await Promise.all(
        ids.slice(index, index + 6).map((id, offset) =>
          this.matchListed(
            id,
            names[index + offset],
            (lookup) => this.tpdbAdapter.getFeedStudioById(lookup, apiConfig),
            async (name) =>
              (
                await this.tpdbAdapter.getStudiosFeed({
                  ...apiConfig,
                  page: 1,
                  perPage: 10,
                  name,
                })
              ).studios,
            'site',
          ),
        ),
      );
      sites.push(
        ...batch.filter((site): site is StashdbStudioFeedItem => site !== null),
      );
    }
    const uniqueSites = [
      ...new Map(sites.map((site) => [site.id, site])).values(),
    ];
    this.resolvedSites = { key, sites: uniqueSites, at: Date.now() };
    return uniqueSites;
  }

  private async resolvePerformers(
    ids: string[],
    names: string[],
    apiConfig: { baseUrl: string; apiKey: string | null },
  ): Promise<StashdbPerformerFeedItem[]> {
    if (!ids.length) {
      return [];
    }
    const key = `${ids.join(',')}|${names.join(',')}`;
    const cached = this.resolvedPerformers;
    if (
      cached?.key === key &&
      Date.now() - cached.at < TpdbWebService.CACHE_TTL_MS
    ) {
      return cached.performers;
    }

    const performers: StashdbPerformerFeedItem[] = [];
    // A few at a time, to go easy on the API.
    for (let index = 0; index < ids.length; index += 6) {
      const batch = await Promise.all(
        ids.slice(index, index + 6).map((id, offset) =>
          this.matchListed(
            id,
            names[index + offset],
            (lookup) =>
              this.tpdbAdapter.getFeedPerformerById(lookup, apiConfig),
            async (name) =>
              (
                await this.tpdbAdapter.getPerformersFeed({
                  ...apiConfig,
                  page: 1,
                  perPage: 10,
                  name,
                })
              ).performers,
            'performer',
          ),
        ),
      );
      performers.push(
        ...batch.filter(
          (performer): performer is StashdbPerformerFeedItem =>
            performer !== null,
        ),
      );
    }

    // Two listings of one performer: once.
    const unique = [
      ...new Map(
        performers.map((performer) => [performer.id, performer]),
      ).values(),
    ];
    if (unique.length < ids.length) {
      this.logger.warn(
        `Popular performers: ${unique.length} of ${ids.length} found through the API.`,
      );
    }
    this.resolvedPerformers = { key, performers: unique, at: Date.now() };
    return unique;
  }

  /**
   * The API record for one entry of a homepage list: by its id when that's
   * the one shown (same name), else the one with its name (the website's
   * ids aren't always the API's). Without a name, just by id.
   */
  private async matchListed<T extends { id: string; name: string }>(
    id: string,
    name: string | undefined,
    byId: (id: string) => Promise<T | null>,
    byName: (name: string) => Promise<T[]>,
    kind: 'performer' | 'site',
  ): Promise<T | null> {
    const found = await byId(id);
    const wanted = name ? TpdbWebService.nameKey(name) : '';
    if (!wanted || (found && TpdbWebService.nameKey(found.name) === wanted)) {
      return found;
    }
    try {
      const named = (await byName(name!)).filter(
        (item) => TpdbWebService.nameKey(item.name) === wanted,
      );
      // Several of that name: the busiest (a performer's main profile).
      const best =
        named.sort(
          (a, b) =>
            ((b as { sceneCount?: number }).sceneCount ?? 0) -
            ((a as { sceneCount?: number }).sceneCount ?? 0),
        )[0] ?? null;
      if (best) {
        return best;
      }
    } catch {
      // (Search failing: keep the id's.)
    }
    this.logger.warn(
      `Popular ${kind} "${name}" (${id}): no API record of that name${
        found ? `; the id gives "${found.name}", skipped` : ''
      }.`,
    );
    return null;
  }

  private static nameKey(name: string): string {
    return name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private isDue(account: TpdbWebAccount): boolean {
    const now = Date.now();
    if (account.lastError && account.lastAttemptAt) {
      return (
        now - account.lastAttemptAt.getTime() >
        TpdbWebService.RETRY_AFTER_FAILURE_MS
      );
    }

    return (
      !account.popularFetchedAt ||
      now - account.popularFetchedAt.getTime() > TpdbWebService.CACHE_TTL_MS
    );
  }

  private async resolveScenes(
    ids: string[],
    apiConfig: { baseUrl: string; apiKey: string | null },
  ): Promise<StashdbScene[]> {
    const key = ids.join(',');
    if (!key) {
      return [];
    }
    if (
      this.resolved?.key === key &&
      Date.now() - this.resolved.at < TpdbWebService.CACHE_TTL_MS
    ) {
      return this.resolved.scenes;
    }

    const scenes: StashdbScene[] = [];
    // A few at a time, to go easy on the API.
    for (let index = 0; index < ids.length; index += 6) {
      const batch = await Promise.all(
        ids
          .slice(index, index + 6)
          .map((id) => this.tpdbAdapter.getFeedSceneById(id, apiConfig)),
      );
      scenes.push(
        ...batch.filter((scene): scene is StashdbScene => scene !== null),
      );
    }

    this.resolved = { key, scenes, at: Date.now() };
    return scenes;
  }

  // One refresh at a time.
  private refresh(account: TpdbWebAccount): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.performRefresh(account).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async performRefresh(account: TpdbWebAccount): Promise<void> {
    const jar: CookieJar = {
      ...((account.sessionCookies as CookieJar | null) ?? {}),
    };
    try {
      let home = await this.getPage('/', jar);
      if (this.isSignInPage(home)) {
        await this.signIn(account, jar);
        home = await this.getPage('/', jar);
      }
      if (this.isSignInPage(home)) {
        throw new Error('Signed in, but TPDB still shows the sign-in page.');
      }

      const found = this.findList(home.props, 'scene');
      if (!found) {
        const keys = Object.keys(home.props).join(', ');
        throw new Error(
          `Couldn't find a scene list on the TPDB homepage (page "${home.component}", data: ${keys}).`,
        );
      }

      const performers = this.findPopular(home, 'performer');
      const sites = this.findPopular(home, 'site');

      await this.prisma.tpdbWebAccount.update({
        where: { id: 1 },
        data: {
          sessionCookies: jar,
          popularSceneIds: found.ids.slice(0, TpdbWebService.MAX_SCENES),
          popularSourcePath: found.path,
          popularPerformerIds:
            performers?.ids.slice(0, TpdbWebService.MAX_PERFORMERS) ?? [],
          popularPerformerSourcePath: performers?.path ?? null,
          popularPerformerNames:
            performers?.names.slice(0, TpdbWebService.MAX_PERFORMERS) ?? [],
          popularSiteIds: sites?.ids.slice(0, TpdbWebService.MAX_SITES) ?? [],
          popularSiteSourcePath: sites?.path ?? null,
          popularSiteNames:
            sites?.names.slice(0, TpdbWebService.MAX_SITES) ?? [],
          popularFetchedAt: new Date(),
          lastAttemptAt: new Date(),
          lastError: null,
        },
      });
      this.logger.log(
        `Read ${found.ids.length} popular scenes from the TPDB homepage (${found.path}).`,
      );
      this.logger.log(
        performers
          ? `Read ${performers.ids.length} popular performers from the TPDB website (${performers.path}): ${performers.names.join(', ')}.`
          : 'No popular performers list on the TPDB homepage: ranked from the popular scenes.',
      );
      this.logger.log(
        sites
          ? `Read ${sites.ids.length} popular sites from the TPDB website (${sites.path}): ${sites.names.join(', ')}.`
          : 'No popular sites list on the TPDB homepage: ranked from the popular scenes.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`TPDB website: ${message}`);
      await this.prisma.tpdbWebAccount.update({
        where: { id: 1 },
        data: {
          sessionCookies: jar,
          lastAttemptAt: new Date(),
          lastError: message,
        },
      });
      throw error;
    }
  }

  // Laravel Fortify / Inertia sign-in: XSRF cookie from the login page, then
  // a JSON POST; Inertia answers with a redirect either way, so success is
  // judged by the homepage afterwards.
  private async signIn(account: TpdbWebAccount, jar: CookieJar): Promise<void> {
    for (const name of Object.keys(jar)) {
      delete jar[name];
    }
    const loginPage = await this.getPage('/login', jar);
    const xsrf = jar['XSRF-TOKEN'];
    if (!xsrf) {
      throw new Error(
        'TPDB sign-in page gave no XSRF token (the site may have changed).',
      );
    }

    const response = await this.request('/login', jar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/html, application/xhtml+xml',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Inertia': 'true',
        ...(loginPage.version
          ? { 'X-Inertia-Version': loginPage.version }
          : {}),
        'X-XSRF-TOKEN': decodeURIComponent(xsrf),
        Origin: TpdbWebService.SITE,
        Referer: `${TpdbWebService.SITE}/login`,
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        remember: true,
      }),
    });

    const location =
      response.headers.get('location') ??
      response.headers.get('x-inertia-location') ??
      '';
    if (/two-factor/i.test(location)) {
      throw new Error(
        "This TPDB account uses two-factor sign-in, which Peeparr can't complete.",
      );
    }
    if (response.status === 429) {
      throw new Error('TPDB is rate-limiting sign-ins; will try again later.');
    }
    if (/\/login/.test(location)) {
      // Back to the form: read its error message.
      const again = await this.getPage('/login', jar);
      const errors = again.props['errors'] as
        Record<string, string | string[]> | undefined;
      const message = errors ? Object.values(errors).flat()[0] : null;
      throw new Error(
        `TPDB sign-in failed: ${message ?? 'wrong email or password?'}`,
      );
    }
  }

  /**
   * A list of popular performers (sites) on the homepage -- one labelled
   * popular / trending / top. Null without one: they're then ranked from
   * the popular scenes (see rankFromPopularScenes). (The website's
   * performers and sites pages list the newest first: not used.)
   */
  private findPopular(
    home: InertiaPage,
    kind: 'performer' | 'site',
  ): { path: string; ids: string[]; names: string[] } | null {
    const named =
      kind === 'performer' ? /performer|model|star/i : /site|studio|channel/i;
    const onHome = this.findList(home.props, kind);
    return onHome &&
      named.test(onHome.path) &&
      /popular|trend|top|hot|most/i.test(onHome.path)
      ? { path: `/ ${onHome.path}`, ids: onHome.ids, names: onHome.names }
      : null;
  }

  private isSignInPage(page: InertiaPage): boolean {
    return /login/i.test(page.component) || /\/login/.test(page.url);
  }

  /**
   * The best-looking list of scenes (objects with a title and an id), or
   * performers or sites (a name and an id, no title) in the page data,
   * preferring a "popular" one (then trending / top) named for its kind.
   */
  private findList(
    props: Record<string, unknown>,
    kind: 'scene' | 'performer' | 'site',
  ): { path: string; ids: string[]; names: string[] } | null {
    const isItem = (item: Record<string, unknown>) =>
      kind === 'scene'
        ? typeof item['title'] === 'string'
        : typeof item['name'] === 'string' && typeof item['title'] !== 'string';
    const candidates: Array<{
      path: string;
      items: Record<string, unknown>[];
    }> = [];
    const walk = (value: unknown, path: string, depth: number) => {
      if (depth > 6 || value === null || typeof value !== 'object') {
        return;
      }
      if (Array.isArray(value)) {
        const items = value.filter(
          (item): item is Record<string, unknown> =>
            !!item &&
            typeof item === 'object' &&
            isItem(item as Record<string, unknown>),
        );
        // (Not a list inside another's items: a scene's own performers.)
        const nested = kind !== 'scene' && path.includes('[');
        if (
          !nested &&
          items.length >= 3 &&
          items.length >= value.length * 0.8 &&
          items.some((item) => this.sceneId(item))
        ) {
          candidates.push({ path, items });
        }
        value.forEach((item, index) =>
          walk(item, `${path}[${index}]`, depth + 1),
        );
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    };
    walk(props, '', 0);

    const others = {
      scene: /movie|performer|site|jav/i,
      performer: /scene|movie|site|studio|jav|tag/i,
      site: /scene|movie|performer|model|jav|tag/i,
    }[kind];
    const score = (path: string) =>
      (/popular/i.test(path)
        ? 100
        : /trend|top|hot|most/i.test(path)
          ? 50
          : 0) +
      (new RegExp(kind, 'i').test(path) ? 10 : 0) -
      (others.test(path) ? 40 : 0);
    candidates.sort(
      (a, b) =>
        score(b.path) - score(a.path) || b.items.length - a.items.length,
    );
    const best = candidates[0];
    if (!best) {
      return null;
    }

    // A performer listed as a site's profile: its main performer (the one
    // the API can look up) is its parent.
    const idOf = (item: Record<string, unknown>) => {
      const parent = item['parent'];
      return kind === 'performer' && parent && typeof parent === 'object'
        ? (this.sceneId(parent as Record<string, unknown>) ??
            this.sceneId(item))
        : this.sceneId(item);
    };
    // Each entry's id and the name shown for it, in order, once each.
    const entries = new Map<string, string>();
    for (const item of best.items) {
      const id = idOf(item);
      if (id && !entries.has(id)) {
        // (A site profile: its main performer's name, the one looked up.)
        const parent = item['parent'] as Record<string, unknown> | undefined;
        const label =
          kind === 'performer' && typeof parent?.['name'] === 'string'
            ? parent['name']
            : item[kind === 'scene' ? 'title' : 'name'];
        entries.set(id, typeof label === 'string' ? label.trim() : '');
      }
    }
    if (kind !== 'scene') {
      // What its entries hold (field names only), for when it doesn't resolve.
      const sample = best.items[0] ?? {};
      const parent = sample['parent'];
      this.logger.log(
        `TPDB ${kind} list ${best.path}: entries have ${Object.keys(sample).join(', ')}${
          parent && typeof parent === 'object'
            ? `; parent has ${Object.keys(parent as Record<string, unknown>).join(', ')}`
            : ''
        }.`,
      );
    }
    return {
      path: best.path,
      ids: [...entries.keys()],
      names: [...entries.values()],
    };
  }

  // TPDB API ids (scenes', performers') are uuids; take the page's uuid, else whatever id it has.
  private sceneId(item: Record<string, unknown>): string | null {
    for (const key of ['uuid', 'id', '_id', 'slug']) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }
    return null;
  }

  // GET a page (following redirects) and read its Inertia page data.
  private async getPage(path: string, jar: CookieJar): Promise<InertiaPage> {
    let url = path;
    let response: Response | null = null;
    for (let hop = 0; hop < 5; hop += 1) {
      response = await this.request(url, jar, {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        url = location;
        continue;
      }
      break;
    }
    if (!response || !response.ok) {
      throw new Error(
        `TPDB website answered ${response?.status ?? 'nothing'} for ${path}.`,
      );
    }

    const html = await response.text();
    const inScript = html.match(
      /<script[^>]*data-page[^>]*>([\s\S]*?)<\/script>/,
    );
    const inAttribute = html.match(/data-page="([^"]+)"/);
    const raw =
      inScript?.[1] ?? (inAttribute ? this.unescapeHtml(inAttribute[1]) : null);
    if (!raw) {
      throw new Error(
        'TPDB page had no page data (the site may have changed).',
      );
    }

    const page = JSON.parse(raw) as Partial<InertiaPage>;
    return {
      component: page.component ?? '',
      props: (page.props as Record<string, unknown>) ?? {},
      url: page.url ?? url,
      version: typeof page.version === 'string' ? page.version : null,
    };
  }

  private async request(
    url: string,
    jar: CookieJar,
    init: RequestInit,
  ): Promise<Response> {
    const absolute = new URL(url, TpdbWebService.SITE).toString();
    if (!absolute.startsWith(TpdbWebService.SITE)) {
      throw new Error('Refusing to follow a redirect off theporndb.net.');
    }

    const cookieHeader = Object.entries(jar)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    const response = await fetch(absolute, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(TpdbWebService.REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': TpdbWebService.USER_AGENT,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(init.headers as Record<string, string>),
      },
    });
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) {
        jar[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
      }
    }
    return response;
  }

  private unescapeHtml(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
}
