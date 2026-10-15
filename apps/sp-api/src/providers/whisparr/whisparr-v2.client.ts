import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fetchWithTimeout } from '../fetch-with-timeout';
import type {
  WhisparrAdapterBaseConfig,
  WhisparrCreateMovieInput,
  WhisparrCreateMovieResult,
  WhisparrMovieLookupResult,
} from './whisparr.adapter';

/** ThePornDB's numeric ids for a scene and its site: what Whisparr v2 uses. */
interface TpdbNumericIds {
  sceneId: number;
  siteId: number;
}

interface V2Series {
  id: number;
  tvdbId: number;
  title: string | null;
  titleSlug: string | null;
  monitored: boolean;
}

interface V2Episode {
  id: number;
  seriesId: number;
  tvdbId: number;
  episodeFileId: number;
  title: string | null;
  overview: string | null;
  releaseDate: string | null;
  runtime: number | null;
  monitored: boolean;
  hasFile: boolean;
}

/**
 * Whisparr v2 (built on Sonarr). Each site is a "series" and each scene an
 * "episode" in it, both keyed by ThePornDB's numeric ids, where Eros has one
 * "movie" per scene keyed by the catalog's id. This speaks v2's API in the
 * terms the rest of the app uses for Eros: a scene's "movie" here is its
 * episode, and it counts as requested once it's monitored or has a file
 * (adding a site brings in every one of its scenes, unmonitored).
 *
 * v2 only knows ThePornDB, so scenes from StashDB or FansDB can't be
 * requested through it.
 */
@Injectable()
export class WhisparrV2Client {
  /** Whisparr v2's own metadata service: maps a scene's numeric id back to its ThePornDB UUID. */
  static readonly METADATA_URL = 'https://api.whisparr.com/v3';
  /** How long to wait for a newly added site's scenes to appear. */
  private static readonly EPISODES_WAIT_MS = 60_000;
  private static readonly EPISODES_POLL_MS = 1_500;

  private readonly logger = new Logger(WhisparrV2Client.name);
  private readonly numericIdsByUuid = new Map<string, TpdbNumericIds | null>();
  private readonly uuidBySceneId = new Map<number, string | null>();
  private readonly seriesSlugByEpisodeId = new Map<number, string>();

  constructor(private readonly prisma: PrismaService) {}

  async findByStashId(
    stashId: string,
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrMovieLookupResult | null> {
    const ids = await this.numericIds(stashId);
    if (!ids) {
      return null;
    }

    const series = await this.seriesByTpdbId(ids.siteId, config);
    if (!series) {
      return null;
    }

    const episode = (await this.episodes(series.id, config)).find(
      (entry) => entry.tvdbId === ids.sceneId,
    );
    if (!episode || !this.isRequested(episode)) {
      return null;
    }

    return this.toLookupResult(episode, series, stashId);
  }

  async findById(
    episodeId: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrMovieLookupResult | null> {
    const payload = await this.request(config, 'GET', `episode/${episodeId}`, {
      allowNotFound: true,
    });
    const episode = this.parseEpisode(payload);
    if (!episode || !this.isRequested(episode)) {
      return null;
    }

    const series = this.parseSeries(
      await this.request(config, 'GET', `series/${episode.seriesId}`, {
        allowNotFound: true,
      }),
    );
    const stashId = await this.uuidForScene(episode.tvdbId);
    if (!series || !stashId) {
      return null;
    }

    return this.toLookupResult(episode, series, stashId);
  }

  /** Every requested scene: monitored or downloaded episodes across all sites. */
  async snapshot(
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrMovieLookupResult[]> {
    const allSeries = this.parseList(
      await this.request(config, 'GET', 'series'),
      (entry) => this.parseSeries(entry),
    );

    const results: WhisparrMovieLookupResult[] = [];
    for (const series of allSeries) {
      const requested = (await this.episodes(series.id, config)).filter(
        (episode) => this.isRequested(episode),
      );
      const stashIds = await this.mapLimited(requested, 4, (episode) =>
        this.uuidForScene(episode.tvdbId),
      );
      requested.forEach((episode, index) => {
        const stashId = stashIds[index];
        if (stashId) {
          results.push(this.toLookupResult(episode, series, stashId));
        }
      });
    }

    return results;
  }

  async create(
    input: WhisparrCreateMovieInput,
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrCreateMovieResult> {
    const ids = await this.numericIds(input.foreignId);
    if (!ids) {
      throw new BadRequestException(
        'Whisparr v2 can only request ThePornDB scenes. Choose ThePornDB as the catalog, or use Whisparr Eros.',
      );
    }

    let series = await this.seriesByTpdbId(ids.siteId, config);
    const added = !series;
    if (!series) {
      series = await this.addSeries(ids.siteId, input, config);
    } else if (!series.monitored) {
      // An unmonitored site never downloads any of its scenes.
      const full = await this.request(config, 'GET', `series/${series.id}`);
      await this.request(config, 'PUT', `series/${series.id}`, {
        body: { ...(full as Record<string, unknown>), monitored: true },
      });
    }

    const episode = await this.waitForEpisode(
      series.id,
      ids.sceneId,
      added,
      config,
    );
    if (!episode) {
      throw new BadGatewayException(
        `Whisparr v2 doesn't list this scene under ${series.title ?? 'its site'} yet.`,
      );
    }

    if (input.monitored) {
      await this.request(config, 'PUT', 'episode/monitor', {
        body: { episodeIds: [episode.id], monitored: true },
      });
    }
    if (input.addOptions.searchForMovie) {
      await this.request(config, 'POST', 'command', {
        body: { name: 'EpisodeSearch', episodeIds: [episode.id] },
      });
    }

    if (series.titleSlug) {
      this.seriesSlugByEpisodeId.set(episode.id, series.titleSlug);
    }
    return { movieId: episode.id };
  }

  /** Stops the scene downloading (unmonitors it) and optionally deletes its file. */
  async remove(
    episodeId: number,
    config: WhisparrAdapterBaseConfig,
    options?: { deleteFiles?: boolean },
  ): Promise<void> {
    const episode = this.parseEpisode(
      await this.request(config, 'GET', `episode/${episodeId}`, {
        allowNotFound: true,
      }),
    );
    if (!episode) {
      return;
    }

    await this.request(config, 'PUT', 'episode/monitor', {
      body: { episodeIds: [episode.id], monitored: false },
    });
    if (options?.deleteFiles && episode.episodeFileId > 0) {
      await this.request(
        config,
        'DELETE',
        `episodefile/${episode.episodeFileId}`,
        {
          allowNotFound: true,
        },
      );
    }
  }

  /** A scene's page in Whisparr v2 is its site's page. */
  viewPath(episodeId: number): string {
    const slug = this.seriesSlugByEpisodeId.get(episodeId);
    return slug ? `series/${encodeURIComponent(slug)}` : '';
  }

  private async addSeries(
    siteId: number,
    input: WhisparrCreateMovieInput,
    config: WhisparrAdapterBaseConfig,
  ): Promise<V2Series> {
    const lookup = await this.request(
      config,
      'GET',
      `series/lookup?term=${encodeURIComponent(`tpdb:${siteId}`)}`,
    );
    const resource = Array.isArray(lookup)
      ? (lookup[0] as Record<string, unknown>)
      : null;
    if (!resource) {
      throw new BadGatewayException(
        `Whisparr v2 couldn't find ${input.studioTitle || 'this site'} in its metadata.`,
      );
    }

    const created = await this.request(config, 'POST', 'series', {
      body: {
        ...resource,
        qualityProfileId: input.qualityProfileId,
        rootFolderPath: input.rootFolderPath,
        tags: input.tags,
        monitored: true,
        // Only the scenes asked for: none of the site's others, old or new.
        monitorNewItems: 'none',
        addOptions: {
          monitor: 'none',
          searchForMissingEpisodes: false,
          searchForCutoffUnmetEpisodes: false,
        },
      },
    });
    const series = this.parseSeries(created);
    if (!series) {
      throw new BadGatewayException(
        'Whisparr v2 returned an unexpected response when adding the site.',
      );
    }
    return series;
  }

  // A newly added site fills in its scenes a moment later.
  private async waitForEpisode(
    seriesId: number,
    sceneId: number,
    justAdded: boolean,
    config: WhisparrAdapterBaseConfig,
  ): Promise<V2Episode | null> {
    const deadline =
      Date.now() + (justAdded ? WhisparrV2Client.EPISODES_WAIT_MS : 0);
    for (;;) {
      const episodes = await this.episodes(seriesId, config);
      const episode = episodes.find((entry) => entry.tvdbId === sceneId);
      if (
        episode ||
        (episodes.length > 0 && !justAdded) ||
        Date.now() >= deadline
      ) {
        return episode ?? null;
      }
      if (episodes.length > 0) {
        // The site's scenes are in, without this one.
        return null;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, WhisparrV2Client.EPISODES_POLL_MS),
      );
    }
  }

  private async seriesByTpdbId(
    siteId: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<V2Series | null> {
    const list = this.parseList(
      await this.request(config, 'GET', `series?tvdbId=${siteId}`),
      (entry) => this.parseSeries(entry),
    );
    return list.find((series) => series.tvdbId === siteId) ?? null;
  }

  private async episodes(
    seriesId: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<V2Episode[]> {
    return this.parseList(
      await this.request(config, 'GET', `episode?seriesId=${seriesId}`),
      (entry) => this.parseEpisode(entry),
    );
  }

  private isRequested(episode: V2Episode): boolean {
    return episode.monitored || episode.hasFile;
  }

  private toLookupResult(
    episode: V2Episode,
    series: V2Series,
    stashId: string,
  ): WhisparrMovieLookupResult {
    if (series.titleSlug) {
      this.seriesSlugByEpisodeId.set(episode.id, series.titleSlug);
    }
    return {
      movieId: episode.id,
      stashId,
      hasFile: episode.hasFile,
      cachedTitle: episode.title,
      cachedOverview: episode.overview,
      cachedPosterUrl: null,
      cachedStudioId: String(series.tvdbId),
      cachedStudioName: series.title,
      cachedReleaseDate:
        episode.releaseDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
      cachedDurationSeconds: episode.runtime
        ? Math.round(episode.runtime * 60)
        : null,
    };
  }

  // A ThePornDB scene UUID -> its numeric id and its site's, from ThePornDB.
  private async numericIds(stashId: string): Promise<TpdbNumericIds | null> {
    const uuid = stashId.trim();
    if (!uuid) {
      return null;
    }
    if (this.numericIdsByUuid.has(uuid)) {
      return this.numericIdsByUuid.get(uuid) ?? null;
    }

    const tpdb = await this.prisma.integrationConfig.findUnique({
      where: { type: 'TPDB' },
    });
    if (!tpdb?.enabled || !tpdb.baseUrl?.trim()) {
      return null;
    }

    const url = new URL(tpdb.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/scenes/${encodeURIComponent(uuid)}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (tpdb.apiKey?.trim()) {
      headers.Authorization = `Bearer ${tpdb.apiKey.trim()}`;
    }

    let ids: TpdbNumericIds | null = null;
    try {
      const response = await fetchWithTimeout(url.toString(), { headers });
      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>;
        const scene = (body?.data ?? body) as Record<string, unknown>;
        const site = scene?.site as Record<string, unknown> | undefined;
        const sceneId = this.readInt(scene?._id);
        const siteId = this.readInt(site?.id) ?? this.readInt(scene?.site_id);
        ids = sceneId && siteId ? { sceneId, siteId } : null;
      } else if (response.status !== 404) {
        throw new Error(`ThePornDB returned ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Couldn't look up ThePornDB ids for scene ${uuid}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }

    this.numericIdsByUuid.set(uuid, ids);
    if (ids) {
      this.uuidBySceneId.set(ids.sceneId, uuid);
    }
    return ids;
  }

  // A scene's numeric id -> its ThePornDB UUID, from Whisparr's metadata service.
  private async uuidForScene(sceneId: number): Promise<string | null> {
    if (this.uuidBySceneId.has(sceneId)) {
      return this.uuidBySceneId.get(sceneId) ?? null;
    }

    let uuid: string | null = null;
    try {
      const response = await fetchWithTimeout(
        `${WhisparrV2Client.METADATA_URL}/scene/${sceneId}`,
        { headers: { Accept: 'application/json' } },
      );
      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>;
        uuid = this.readString(body?.ForeignGuid);
      } else if (response.status !== 404) {
        throw new Error(`metadata service returned ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Couldn't map Whisparr v2 scene ${sceneId} to ThePornDB: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }

    this.uuidBySceneId.set(sceneId, uuid);
    return uuid;
  }

  private async request(
    config: WhisparrAdapterBaseConfig,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options?: { body?: unknown; allowNotFound?: boolean },
  ): Promise<unknown> {
    const base = new URL(config.baseUrl);
    const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/api/v3/${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (config.apiKey?.trim()) {
      headers['X-Api-Key'] = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method,
        headers,
        body:
          options?.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
      });
    } catch {
      throw new BadGatewayException(
        'Failed to reach Whisparr provider endpoint.',
      );
    }

    if (response.status === 404 && options?.allowNotFound) {
      return null;
    }
    const text = await response.text();
    if (!response.ok) {
      this.logger.error(
        `Whisparr v2 ${method} ${path} returned ${response.status}: ${text.slice(0, 500)}`,
      );
      throw new BadGatewayException(
        `Whisparr provider returned ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new BadGatewayException(
        'Whisparr provider returned an invalid JSON response.',
      );
    }
  }

  private async mapLimited<T, R>(
    items: T[],
    limit: number,
    work: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (next < items.length) {
          const index = next++;
          results[index] = await work(items[index]);
        }
      },
    );
    await Promise.all(workers);
    return results;
  }

  private parseList<T>(
    payload: unknown,
    parse: (entry: unknown) => T | null,
  ): T[] {
    if (!Array.isArray(payload)) {
      throw new BadGatewayException(
        'Whisparr provider returned an unexpected response shape.',
      );
    }
    return payload.map(parse).filter((entry): entry is T => entry !== null);
  }

  private parseSeries(entry: unknown): V2Series | null {
    const record = entry as Record<string, unknown> | null;
    const id = this.readInt(record?.id);
    const tvdbId = this.readInt(record?.tvdbId);
    if (!record || !id || !tvdbId) {
      return null;
    }
    return {
      id,
      tvdbId,
      title: this.readString(record.title),
      titleSlug: this.readString(record.titleSlug),
      monitored: record.monitored === true,
    };
  }

  private parseEpisode(entry: unknown): V2Episode | null {
    const record = entry as Record<string, unknown> | null;
    const id = this.readInt(record?.id);
    const seriesId = this.readInt(record?.seriesId);
    const tvdbId = this.readInt(record?.tvdbId);
    if (!record || !id || !seriesId || !tvdbId) {
      return null;
    }
    return {
      id,
      seriesId,
      tvdbId,
      episodeFileId: this.readInt(record.episodeFileId) ?? 0,
      title: this.readString(record.title),
      overview: this.readString(record.overview),
      releaseDate: this.readString(record.releaseDate),
      runtime: this.readInt(record.runtime),
      monitored: record.monitored === true,
      hasFile: record.hasFile === true,
    };
  }

  private readInt(value: unknown): number | null {
    const number =
      typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    return typeof number === 'number' && Number.isInteger(number) && number > 0
      ? number
      : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
