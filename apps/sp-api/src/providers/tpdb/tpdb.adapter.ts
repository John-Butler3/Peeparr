import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RuntimeHealthServiceKey } from '@prisma/client';
import { RuntimeHealthService } from '../../runtime-health/runtime-health.service';
import { fetchWithTimeout } from '../fetch-with-timeout';
import type { CatalogAdapter } from '../catalog/catalog-adapter.interface';
import {
  StashdbAdapterBaseConfig,
  StashdbAdapterSceneFeedConfig,
  StashdbAdapterTrendingConfig,
  StashdbFavoriteResult,
  StashdbPerformerDetails,
  StashdbPerformerFeedConfig,
  StashdbPerformerFeedItem,
  StashdbPerformerScenesConfig,
  StashdbPerformersFeedResult,
  StashdbScene,
  StashdbSceneDetails,
  StashdbSceneImage,
  StashdbSceneMetadata,
  StashdbSceneTag,
  StashdbSceneUrl,
  StashdbScenePerformer,
  StashdbStudioChildSummary,
  StashdbStudioDetails,
  StashdbStudioFeedItem,
  StashdbStudioOption,
  StashdbStudioUrl,
  StashdbStudiosFeedConfig,
  StashdbStudiosFeedResult,
  StashdbTagOption,
  StashdbTagSearchConfig,
  StashdbTrendingScenesResult,
} from '../stashdb/stashdb.adapter';

/**
 * REST client for TPDB (ThePornDB, api.theporndb.net). Response shapes below
 * were verified against the live API, not just third-party docs. TPDB also
 * exposes a stash-box-compatible GraphQL endpoint at /graphql (same protocol
 * as StashDB) — used here only for favoritePerformer/favoriteStudio, since
 * the equivalent GraphQL scene/performer list queries (queryScenes) were
 * confirmed broken server-side (always returns null results), so scene
 * browsing stays on the REST endpoints above.
 */
@Injectable()
export class TpdbAdapter implements CatalogAdapter {
  private static readonly DEFAULT_PAGE_SIZE = 24;
  private static readonly MAX_RATE_LIMIT_RETRIES = 3;
  // Amateur/creator-platform names a user can choose to hide (see
  // AppSettings.hideAmateurNetworkResults) for scenes not already in their
  // library. Matched case-insensitively against the scene's network name,
  // site name, and URL, since TPDB doesn't always populate a full `network`
  // object on every site.
  private static readonly EXCLUDABLE_NETWORK_NAMES = ['manyvids', 'fansdb'];
  private readonly logger = new Logger(TpdbAdapter.name);

  constructor(private readonly runtimeHealthService: RuntimeHealthService) {}

  async testConnection(config: StashdbAdapterBaseConfig): Promise<void> {
    await this.checkConnection(config, false);
  }

  async probeConnection(config: StashdbAdapterBaseConfig): Promise<void> {
    await this.checkConnection(config, true);
  }

  private async checkConnection(
    config: StashdbAdapterBaseConfig,
    trackRuntimeHealth: boolean,
  ): Promise<void> {
    await this.trackRuntimeHealth(
      () => this.fetchJson(this.resolveUrl(config.baseUrl, 'scenes', { per_page: '1' }), config),
      trackRuntimeHealth,
    );
  }

  async getScenesSortedByDate(
    config: StashdbAdapterTrendingConfig,
  ): Promise<StashdbTrendingScenesResult> {
    return this.fetchScenesPage(config, { sort: 'DATE' });
  }

  async getScenesBySort(
    config: StashdbAdapterSceneFeedConfig,
  ): Promise<StashdbTrendingScenesResult> {
    return this.fetchScenesPage(config, {
      sort: config.sort,
      titleQuery: config.titleQuery,
      studioIds: config.studioIds,
    });
  }

  private async fetchScenesPage(
    config: StashdbAdapterBaseConfig & { page: number; perPage: number },
    filters: { sort?: string; titleQuery?: string; studioIds?: string[] },
  ): Promise<StashdbTrendingScenesResult> {
    return this.trackRuntimeHealth(async () => {
      const params: Record<string, string> = {
        page: String(config.page),
        per_page: String(config.perPage || TpdbAdapter.DEFAULT_PAGE_SIZE),
      };

      if (filters.titleQuery?.trim()) {
        params.q = filters.titleQuery.trim();
      }
      // TPDB's ordering parameter is `orderBy` (validated: anything else is a
      // 422); `sort` is silently ignored. Confirmed live, it accepts only
      // recently_released / recently_created / recently_updated -- there is
      // no popularity ordering (the site's "popular" list is for logged-in
      // members only). Without it TPDB lists scenes in the order they were
      // added, which is mostly a flood of fresh ManyVids uploads; "recently
      // released" gives new studio releases by release date. Title searches
      // keep TPDB's own relevance order.
      if (!params.q) {
        params.orderBy = 'recently_released';
      }
      // TPDB only filters scenes by a single site_id at a time; use the
      // first requested studio if any were given.
      const studioId = filters.studioIds?.[0]?.trim();
      if (studioId) {
        params.site_id = studioId;
      }

      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, 'scenes', params),
        config,
      );
      const { items, total } = this.extractPage(payload);

      return {
        total,
        scenes: items
          .map((entry) => this.mapSceneListEntry(entry))
          .filter((scene): scene is StashdbScene => scene !== null),
      };
    });
  }

  async searchTags(config: StashdbTagSearchConfig): Promise<StashdbTagOption[]> {
    return this.trackRuntimeHealth(async () => {
      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, 'tags', { q: config.query, per_page: '20' }),
        config,
      );
      const { items } = this.extractPage(payload);

      return items
        .map((entry): StashdbTagOption | null => {
          const record = this.asRecord(entry);
          const id = this.readIdAsString(record?.id);
          const name = this.readString(record?.name);
          if (!id || !name) {
            return null;
          }

          return { id, name, description: null, aliases: [] };
        })
        .filter((tag): tag is StashdbTagOption => tag !== null);
    });
  }

  async getPerformersFeed(
    config: StashdbPerformerFeedConfig,
  ): Promise<StashdbPerformersFeedResult> {
    return this.trackRuntimeHealth(async () => {
      const params: Record<string, string> = {
        page: String(config.page),
        per_page: String(config.perPage || TpdbAdapter.DEFAULT_PAGE_SIZE),
      };
      if (config.name?.trim()) {
        params.q = config.name.trim();
      }

      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, 'performers', params),
        config,
      );
      const { items, total } = this.extractPage(payload);

      return {
        total,
        performers: items
          .map((entry) => this.mapPerformerListEntry(entry))
          .filter((performer): performer is StashdbPerformerFeedItem => performer !== null),
      };
    });
  }

  async getStudiosFeed(
    config: StashdbStudiosFeedConfig,
  ): Promise<StashdbStudiosFeedResult> {
    return this.trackRuntimeHealth(async () => {
      const params: Record<string, string> = {
        page: String(config.page),
        per_page: String(config.perPage || TpdbAdapter.DEFAULT_PAGE_SIZE),
      };
      if (config.name?.trim()) {
        params.q = config.name.trim();
      }

      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, 'sites', params),
        config,
      );
      const { items, total } = this.extractPage(payload);

      return {
        total,
        studios: items
          .map((entry) => this.mapStudioListEntry(entry))
          .filter((studio): studio is StashdbStudioFeedItem => studio !== null),
      };
    });
  }

  async getPerformerById(
    performerId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbPerformerDetails> {
    return this.trackRuntimeHealth(async () => {
      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, `performers/${encodeURIComponent(performerId)}`),
        config,
      );
      const record = this.asRecord((payload as Record<string, unknown>)?.data ?? payload);
      const id = this.readIdAsString(record?.id);
      const name = this.readString(record?.name);
      if (!record || !id || !name) {
        throw new NotFoundException(`Performer ${performerId} not found in TPDB.`);
      }

      const extras = this.asRecord(record.extras);
      const images = this.performerImages(record);

      return {
        id,
        name,
        disambiguation: null,
        aliases: this.readStringArray(record.aliases),
        gender: this.normalizeGender(this.readString(extras?.gender)),
        birthDate: this.readString(extras?.birthday),
        deathDate: this.readString(extras?.deathday),
        age: null,
        ethnicity: this.readString(extras?.ethnicity),
        country: this.readString(extras?.nationality),
        eyeColor: this.readString(extras?.eye_colour),
        hairColor: this.readString(extras?.hair_colour),
        height: this.readString(extras?.height) ?? this.readNumberAsString(extras?.height),
        cupSize: this.readString(extras?.cupsize),
        bandSize: null,
        waistSize: this.readNumber(extras?.waist),
        hipSize: this.readNumber(extras?.hips),
        breastType:
          typeof extras?.fake_boobs === 'boolean'
            ? extras.fake_boobs
              ? 'Fake'
              : 'Natural'
            : null,
        careerStartYear: this.readNumber(extras?.career_start_year),
        careerEndYear: this.readNumber(extras?.career_end_year),
        deleted: false,
        mergedIds: [],
        mergedIntoId: null,
        isFavorite: false,
        createdAt: null,
        updatedAt: null,
        imageUrl: images[0]?.url ?? null,
        images,
      };
    });
  }

  async getStudioById(
    studioId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbStudioDetails> {
    return this.trackRuntimeHealth(async () => {
      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, `sites/${encodeURIComponent(studioId)}`),
        config,
      );
      const record = this.asRecord((payload as Record<string, unknown>)?.data ?? payload);
      const id = this.readIdAsString(record?.id);
      const name = this.readString(record?.name);
      if (!record || !id || !name) {
        throw new NotFoundException(`Studio ${studioId} not found in TPDB.`);
      }

      const images = this.studioImages(record);
      const url = this.readString(record.url);
      const urls: StashdbStudioUrl[] = url
        ? [{ url, type: null, siteName: null, siteUrl: null, siteIcon: null }]
        : [];
      const network = this.asRecord(record.network);
      const networkId = this.readIdAsString(network?.id);
      const networkName = this.readString(network?.name);

      const childStudios: StashdbStudioChildSummary[] = [];

      return {
        id,
        name,
        aliases: [],
        deleted: false,
        isFavorite: false,
        createdAt: null,
        updatedAt: null,
        imageUrl: images[0]?.url ?? null,
        images,
        urls,
        parentStudio:
          networkId && networkName
            ? { id: networkId, name: networkName, aliases: [], isFavorite: false, urls: [] }
            : null,
        childStudios,
      };
    });
  }

  async searchStudios(
    queryText: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbStudioOption[]> {
    return this.trackRuntimeHealth(async () => {
      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, 'sites', { q: queryText, per_page: '20' }),
        config,
      );
      const { items } = this.extractPage(payload);

      return items
        .map((entry): StashdbStudioOption | null => {
          const record = this.asRecord(entry);
          const id = this.readIdAsString(record?.id);
          const name = this.readString(record?.name);
          if (!id || !name) {
            return null;
          }

          return { id, name, childStudios: [] };
        })
        .filter((studio): studio is StashdbStudioOption => studio !== null);
    });
  }

  async getScenesForPerformer(
    config: StashdbPerformerScenesConfig,
  ): Promise<StashdbTrendingScenesResult> {
    return this.trackRuntimeHealth(async () => {
      // The scenes list filter needs the performer's legacy numeric id, not
      // the canonical UUID this app uses everywhere else as the performer id.
      const performerPayload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, `performers/${encodeURIComponent(config.performerId)}`),
        config,
      );
      const performerRecord = this.asRecord(
        (performerPayload as Record<string, unknown>)?.data ?? performerPayload,
      );
      const numericId = this.readNumber(performerRecord?._id);
      if (numericId === null) {
        return { total: 0, scenes: [] as StashdbScene[] };
      }

      const params: Record<string, string> = {
        page: String(config.page),
        per_page: String(config.perPage || TpdbAdapter.DEFAULT_PAGE_SIZE),
        performer_id: String(numericId),
        sort: 'date',
      };
      const studioId = config.studioIds?.[0]?.trim();
      if (studioId) {
        params.site_id = studioId;
      }

      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, 'scenes', params),
        config,
      );
      const { items, total } = this.extractPage(payload);

      return {
        total,
        scenes: items
          .map((entry) => this.mapSceneListEntry(entry))
          .filter((scene): scene is StashdbScene => scene !== null),
      };
    });
  }

  async getSceneById(
    sceneId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbSceneDetails> {
    return this.trackRuntimeHealth(async () => {
      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, `scenes/${encodeURIComponent(sceneId)}`),
        config,
      );
      const record = this.asRecord((payload as Record<string, unknown>)?.data ?? payload);
      const id = this.readIdAsString(record?.id);
      const title = this.readString(record?.title);
      if (!record || !id || !title) {
        throw new NotFoundException(`Scene ${sceneId} not found in TPDB.`);
      }

      const site = this.asRecord(record.site);
      const studioId = this.readIdAsString(site?.id);
      const studioName = this.readString(site?.name);
      const studioImages = site ? this.studioImages(site) : [];
      const images = this.sceneImages(record);

      const tags: StashdbSceneTag[] = this.readArray(record.tags)
        .map((entry) => this.asRecord(entry))
        .map((tag): StashdbSceneTag | null => {
          const tagId = this.readIdAsString(tag?.id);
          const tagName = this.readString(tag?.name);
          if (!tagId || !tagName) {
            return null;
          }
          return { id: tagId, name: tagName, description: null };
        })
        .filter((tag): tag is StashdbSceneTag => tag !== null);

      const performers: StashdbScenePerformer[] = this.readArray(record.performers)
        .map((entry) => this.asRecord(entry))
        .map((performer): StashdbScenePerformer | null => {
          // A scene's performers[] entries are site-specific profiles — their
          // own `id` is NOT independently fetchable via GET /performers/{id}
          // (confirmed live: it 404s). The aggregate, fetchable performer
          // lives at performer.parent.{id,name,extras,image,...}; prefer it
          // whenever present, since it's also the richer record (full bio,
          // full extras, higher-res images) rather than the thin site entry.
          const parent = this.asRecord(performer?.parent);
          const performerId = this.readIdAsString(parent?.id ?? performer?.id);
          const performerName = this.readString(parent?.name ?? performer?.name);
          if (!performerId || !performerName) {
            return null;
          }
          const extra = parent
            ? this.asRecord(parent.extras)
            : this.asRecord(performer?.extra);
          return {
            id: performerId,
            name: performerName,
            gender: this.normalizeGender(this.readString(extra?.gender)),
            isFavorite: false,
            imageUrl:
              this.readString(parent?.image) ??
              this.readString(parent?.thumbnail) ??
              this.readString(parent?.face) ??
              this.readString(performer?.image) ??
              this.readString(performer?.thumbnail) ??
              this.readString(performer?.face) ??
              null,
          };
        })
        .filter((performer): performer is StashdbScenePerformer => performer !== null);

      const sceneUrl = this.readString(record.url);
      const sourceUrls: StashdbSceneUrl[] = sceneUrl ? [{ url: sceneUrl, type: null }] : [];

      return {
        id,
        title,
        details: this.readString(record.description),
        imageUrl: images[0]?.url ?? null,
        studioId,
        studioName,
        studioImageUrl: studioImages[0]?.url ?? null,
        releaseDate: this.readString(record.date),
        duration: this.readNumber(record.duration),
        images,
        studioIsFavorite: false,
        tags,
        performers,
        sourceUrls,
      };
    });
  }

  async getSceneMetadataByIds(
    sceneIds: string[],
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbSceneMetadata[]> {
    const normalizedIds = [...new Set(sceneIds.map((id) => id.trim()).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }

    return this.trackRuntimeHealth(async () => {
      const results = await Promise.all(
        normalizedIds.map(async (sceneId) => {
          try {
            const scene = await this.getSceneById(sceneId, config);
            const metadata: StashdbSceneMetadata = {
              id: scene.id,
              title: scene.title,
              details: scene.details,
              imageUrl: scene.imageUrl,
              studioId: scene.studioId,
              studioName: scene.studioName,
              studioImageUrl: scene.studioImageUrl,
              releaseDate: scene.releaseDate,
              duration: scene.duration,
            };
            return metadata;
          } catch (error) {
            this.logger.debug(
              `Skipping unresolved TPDB scene ${sceneId} in bulk metadata fetch: ${this.errorMessage(error)}`,
            );
            return null;
          }
        }),
      );

      return results.filter((scene): scene is StashdbSceneMetadata => scene !== null);
    }, false);
  }

  /**
   * One scene by id (TPDB uuid, numeric id or slug), shaped like a feed
   * entry -- for lists built outside TPDB's own feed (e.g. the website's
   * popular scenes). Null when TPDB doesn't know it.
   */
  async getFeedSceneById(
    sceneId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbScene | null> {
    try {
      const payload = await this.fetchJson(
        this.resolveUrl(config.baseUrl, `scenes/${encodeURIComponent(sceneId)}`),
        config,
      );
      return this.mapSceneListEntry((payload as Record<string, unknown>)?.data ?? payload);
    } catch {
      return null;
    }
  }

  private mapSceneListEntry(entry: unknown): StashdbScene | null {
    const record = this.asRecord(entry);
    const id = this.readIdAsString(record?.id);
    const title = this.readString(record?.title);
    if (!record || !id || !title) {
      return null;
    }

    const images = this.sceneImages(record);
    const site = this.asRecord(record.site);
    const studioId = this.readIdAsString(site?.id) ?? this.readNumberAsString(record.site_id);
    const studioName = this.readString(site?.name);
    const studioImages = site ? this.studioImages(site) : [];
    const date = this.readString(record.date);

    return {
      id,
      title,
      details: this.readString(record.description),
      imageUrl: images[0]?.url ?? null,
      studioId,
      studioName,
      studioImageUrl: studioImages[0]?.url ?? null,
      date,
      releaseDate: date,
      productionDate: null,
      duration: this.readNumber(record.duration),
      isFromExcludedNetwork: this.isFromExcludableNetwork(record, site),
    };
  }

  private isFromExcludableNetwork(
    record: Record<string, unknown>,
    site: Record<string, unknown> | null,
  ): boolean {
    const network = this.asRecord(site?.network);
    const haystacks = [
      this.readString(network?.name),
      this.readString(network?.short_name),
      this.readString(site?.name),
      this.readString(site?.short_name),
      this.readString(record.url),
    ]
      .filter((value): value is string => value !== null)
      .map((value) => value.toLowerCase());

    return TpdbAdapter.EXCLUDABLE_NETWORK_NAMES.some((needle) =>
      haystacks.some((haystack) => haystack.includes(needle)),
    );
  }

  private mapPerformerListEntry(entry: unknown): StashdbPerformerFeedItem | null {
    const record = this.asRecord(entry);
    const id = this.readIdAsString(record?.id);
    const name = this.readString(record?.name);
    if (!record || !id || !name) {
      return null;
    }

    const images = this.performerImages(record);

    return {
      id,
      name,
      gender: this.normalizeGender(
        this.readString(this.asRecord(record.extras)?.gender) ??
          this.readString(
            this.asRecord(this.asRecord(this.readArray(record.site_performers)[0])?.extra)
              ?.gender,
          ),
      ),
      sceneCount: 0,
      isFavorite: false,
      imageUrl: images[0]?.url ?? null,
    };
  }

  private mapStudioListEntry(entry: unknown): StashdbStudioFeedItem | null {
    const record = this.asRecord(entry);
    const id = this.readIdAsString(record?.id);
    const name = this.readString(record?.name);
    if (!record || !id || !name) {
      return null;
    }

    const network = this.asRecord(record.network);
    const images = this.studioImages(record);

    return {
      id,
      name,
      isFavorite: false,
      imageUrl: images[0]?.url ?? null,
      parentStudio:
        network && this.readIdAsString(network.id) && this.readString(network.name)
          ? { id: this.readIdAsString(network.id) as string, name: this.readString(network.name) as string }
          : null,
      childStudios: [],
    };
  }

  private sceneImages(record: Record<string, unknown> | null): StashdbSceneImage[] {
    const images: StashdbSceneImage[] = [];

    // background.* is a direct, wide/landscape CDN asset (no known fixed
    // size) — put it first so it's what scene.imageUrl (hero backdrop, list
    // thumbnails) resolves to, matching a landscape banner.
    const background = this.asRecord(record?.background);
    const backgroundUrl = this.readString(background?.full) ?? this.readString(background?.large);
    if (backgroundUrl) {
      images.push({ id: 'background', url: backgroundUrl, width: null, height: null });
    }

    // TPDB's `poster` field is always served through their smart-crop
    // resize proxy at a fixed 800x1200 (confirmed live across every scene
    // sampled — the dimensions are literally in the URL path). Tagging the
    // real portrait dimensions here is what lets the frontend's portrait-
    // poster filter (scene-page.component.ts's posterImageUrl, which
    // requires real width/height with height > width) actually find it —
    // without this it was always empty for TPDB, silently falling back to
    // whatever scene.imageUrl happened to be.
    const poster = this.readString(record?.poster);
    if (poster) {
      images.push({ id: 'poster', url: poster, width: 800, height: 1200 });
    } else {
      // Only fall back to the generic `image` field when there's no
      // dedicated poster — its dimensions aren't known, so leave them null
      // rather than guessing a portrait aspect that may not be true.
      const fallbackImage = this.readString(record?.image);
      if (fallbackImage) {
        images.push({ id: 'poster', url: fallbackImage, width: null, height: null });
      }
    }

    return images;
  }

  private performerImages(record: Record<string, unknown> | null): StashdbSceneImage[] {
    const images: StashdbSceneImage[] = [];
    const seenUrls = new Set<string>();

    const push = (id: string, url: string | null) => {
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        images.push({ id, url, width: null, height: null });
      }
    };

    push('image', this.readString(record?.image));
    push('thumbnail', this.readString(record?.thumbnail));
    push('face', this.readString(record?.face));

    // `posters` is TPDB's actual per-performer photo gallery (confirmed
    // against the official Jellyfin plugin's model: each entry is
    // {id, url, size, order}, no width/height) -- a real multi-image set
    // distinct from the single image/thumbnail/face fields above. Sorted by
    // `order` so the gallery matches what TPDB itself displays.
    const posters = this.readArray(record?.posters)
      .map((entry) => this.asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .sort((a, b) => (this.readNumber(a.order) ?? 0) - (this.readNumber(b.order) ?? 0));

    for (const poster of posters) {
      const id = this.readIdAsString(poster.id) ?? `poster-${images.length}`;
      push(`poster-${id}`, this.readString(poster.url));
    }

    return images;
  }

  private studioImages(record: Record<string, unknown> | null): StashdbSceneImage[] {
    const images: StashdbSceneImage[] = [];
    const logo = this.readString(record?.logo);
    if (logo) {
      images.push({ id: 'logo', url: logo, width: null, height: null });
    }
    const poster = this.readString(record?.poster);
    if (poster) {
      images.push({ id: 'poster', url: poster, width: null, height: null });
    }
    const favicon = this.readString(record?.favicon);
    if (favicon && images.length === 0) {
      images.push({ id: 'favicon', url: favicon, width: null, height: null });
    }
    return images;
  }

  private normalizeGender(gender: string | null): StashdbPerformerDetails['gender'] {
    if (!gender) {
      return null;
    }

    switch (gender.trim().toUpperCase()) {
      case 'MALE':
        return 'MALE';
      case 'FEMALE':
        return 'FEMALE';
      case 'TRANSGENDER_MALE':
      case 'TRANS MALE':
        return 'TRANSGENDER_MALE';
      case 'TRANSGENDER_FEMALE':
      case 'TRANS FEMALE':
        return 'TRANSGENDER_FEMALE';
      case 'INTERSEX':
        return 'INTERSEX';
      case 'NON_BINARY':
      case 'NON-BINARY':
        return 'NON_BINARY';
      default:
        return 'UNKNOWN';
    }
  }

  private extractPage(payload: unknown): { items: unknown[]; total: number } {
    const record = this.asRecord(payload);
    const items = this.readArray(record?.data);
    const meta = this.asRecord(record?.meta);
    const total = this.readNumber(meta?.total) ?? items.length;
    return { items, total };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readStringArray(value: unknown): string[] {
    return this.readArray(value).filter((entry): entry is string => typeof entry === 'string');
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private readNumberAsString(value: unknown): string | null {
    const num = this.readNumber(value);
    return num === null ? null : String(num);
  }

  private readIdAsString(value: unknown): string | null {
    if (typeof value === 'string') {
      return this.readString(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  async favoritePerformer(
    performerId: string,
    favorite: boolean,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbFavoriteResult> {
    const query = `
      mutation FavoritePerformer($id: ID!) {
        favoritePerformer(id: $id, favorite: ${favorite ? 'true' : 'false'})
      }
    `;

    return this.trackRuntimeHealth(async () => {
      const payload = await this.executeGraphqlMutation(config, query, {
        id: performerId,
      });
      return this.normalizeFavoriteMutationResult(
        payload,
        'favoritePerformer',
        favorite,
      );
    });
  }

  async favoriteStudio(
    studioId: string,
    favorite: boolean,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbFavoriteResult> {
    const query = `
      mutation FavoriteStudio($id: ID!) {
        favoriteStudio(id: $id, favorite: ${favorite ? 'true' : 'false'})
      }
    `;

    return this.trackRuntimeHealth(async () => {
      const payload = await this.executeGraphqlMutation(config, query, {
        id: studioId,
      });
      return this.normalizeFavoriteMutationResult(
        payload,
        'favoriteStudio',
        favorite,
      );
    });
  }

  private normalizeFavoriteMutationResult(
    payload: {
      data?: Record<string, unknown>;
      errors?: Array<{ message?: unknown }>;
    },
    mutationField: 'favoritePerformer' | 'favoriteStudio',
    requestedFavorite: boolean,
  ): StashdbFavoriteResult {
    if (typeof payload.data?.[mutationField] === 'boolean') {
      return {
        favorited: requestedFavorite,
        alreadyFavorited: false,
      };
    }

    const firstErrorMessage =
      typeof payload.errors?.[0]?.message === 'string'
        ? payload.errors[0].message
        : '';

    // TPDB runs the same stash-box protocol as StashDB but is a separate
    // database, so its unique-constraint name isn't guaranteed to match
    // StashDB's — match on "duplicate key" generically instead of pinning to
    // a specific constraint.
    if (requestedFavorite && /duplicate key/i.test(firstErrorMessage)) {
      return {
        favorited: true,
        alreadyFavorited: true,
      };
    }

    if (firstErrorMessage) {
      throw new BadGatewayException(firstErrorMessage);
    }

    throw new BadGatewayException(
      'TPDB favorite mutation returned an invalid response.',
    );
  }

  private async executeGraphqlMutation(
    config: StashdbAdapterBaseConfig,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<{
    data?: Record<string, unknown>;
    errors?: Array<{ message?: unknown }>;
  }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.apiKey?.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(this.resolveGraphqlUrl(config.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      this.logger.error(
        `TPDB GraphQL request failed: ${this.errorMessage(error)}`,
      );
      throw new BadGatewayException('Failed to reach TPDB provider endpoint.');
    }

    if (response.status === 401) {
      throw new BadGatewayException('TPDB rejected the configured API token.');
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `TPDB GraphQL returned ${response.status}: ${body.slice(0, 500)}`,
      );
      throw new BadGatewayException(`TPDB provider returned ${response.status}.`);
    }

    try {
      return await response.json();
    } catch (error) {
      this.logger.error(
        `TPDB GraphQL returned invalid JSON: ${this.errorMessage(error)}`,
      );
      throw new BadGatewayException(
        'TPDB provider returned an invalid JSON response.',
      );
    }
  }

  private resolveGraphqlUrl(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    parsed.pathname = '/graphql';
    parsed.search = '';
    return parsed.toString();
  }

  private resolveUrl(
    baseUrl: string,
    path: string,
    params?: Record<string, string>,
  ): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/${path}`;
    parsed.search = '';

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          parsed.searchParams.set(key, value);
        }
      }
    }

    return parsed.toString();
  }

  private async fetchJson(
    url: string,
    config: StashdbAdapterBaseConfig,
    attempt = 1,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.apiKey?.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(url, { headers });
    } catch (error) {
      this.logger.error(
        `TPDB request failed for ${url}: ${this.errorMessage(error)}`,
      );
      throw new BadGatewayException('Failed to reach TPDB provider endpoint.');
    }

    if (response.status === 429 && attempt <= TpdbAdapter.MAX_RATE_LIMIT_RETRIES) {
      const parsedRetryAfter = Number(response.headers.get('retry-after'));
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0 ? parsedRetryAfter : 1;
      await this.delay(retryAfterSeconds * 1000);
      return this.fetchJson(url, config, attempt + 1);
    }

    if (response.status === 401) {
      throw new BadGatewayException('TPDB rejected the configured API token.');
    }

    if (response.status === 404) {
      throw new NotFoundException('TPDB resource not found.');
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `TPDB returned ${response.status} for ${url}: ${body.slice(0, 500)}`,
      );
      throw new BadGatewayException(`TPDB provider returned ${response.status}.`);
    }

    try {
      return await response.json();
    } catch (error) {
      this.logger.error(
        `TPDB returned invalid JSON for ${url}: ${this.errorMessage(error)}`,
      );
      throw new BadGatewayException('TPDB provider returned an invalid JSON response.');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async trackRuntimeHealth<T>(
    operation: () => Promise<T>,
    trackRuntimeHealth = true,
  ): Promise<T> {
    try {
      const result = await operation();
      if (trackRuntimeHealth) {
        await this.reportRuntimeSuccess();
      }
      return result;
    } catch (error) {
      if (trackRuntimeHealth) {
        await this.reportRuntimeFailure(error);
      }
      throw error;
    }
  }

  private async reportRuntimeSuccess(): Promise<void> {
    try {
      await this.runtimeHealthService.recordSuccess(RuntimeHealthServiceKey.CATALOG);
    } catch (error) {
      this.logger.warn(`Failed to record TPDB runtime recovery: ${this.errorMessage(error)}`);
    }
  }

  private async reportRuntimeFailure(error: unknown): Promise<void> {
    try {
      await this.runtimeHealthService.recordFailure(RuntimeHealthServiceKey.CATALOG, error);
    } catch (reportingError) {
      this.logger.warn(
        `Failed to record TPDB runtime failure: ${this.errorMessage(reportingError)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return 'unknown error';
  }
}
