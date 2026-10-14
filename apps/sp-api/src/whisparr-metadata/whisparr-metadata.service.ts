import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { TpdbAdapter } from '../providers/tpdb/tpdb.adapter';
import {
  StashdbPerformerDetails,
  StashdbSceneDetails,
  StashdbSceneImage,
  StashdbScenePerformer,
  StashdbStudioDetails,
} from '../providers/stashdb/stashdb.adapter';

/**
 * Backs Whisparr's own scene/performer/studio search and lookup with TPDB
 * data. Whisparr calls a "WhisparrMetadata" base URL (default
 * https://api.whisparr.com/v4/{route}) for every metadata operation; pointing
 * that config value at this module's routes makes Whisparr search/pull from
 * TPDB instead. Response shapes below are the exact camelCase contract
 * Whisparr's client deserializes (its JSON serializer uses
 * CamelCasePropertyNamesContractResolver — verified against Whisparr's own
 * source, branch `eros`).
 *
 * Whisparr's Scene item type always reads ExternalIdResource.stashId as the
 * primary key (never tpdbId) when resolving ForeignId — so every id below is
 * placed in the `stashId` slot (with `tpdbId` also populated for accuracy).
 * This only covers the Scene/Performer/Site routes; the separate JAV "Movie"
 * type routes (movie/*, tpdb/movie/*) are intentionally not implemented here.
 */
@Injectable()
export class WhisparrMetadataService {
  private static readonly SEARCH_PAGE_SIZE = 20;
  private static readonly WORKS_PAGE_SIZE = 100;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly tpdbAdapter: TpdbAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async searchScenes(query: string): Promise<unknown[]> {
    const config = await this.getTpdbConfig();
    const result = await this.tpdbAdapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: WhisparrMetadataService.SEARCH_PAGE_SIZE,
      sort: 'TITLE',
      titleQuery: query,
    });

    // TPDB's scene list/search endpoint only returns a numeric site_id, not
    // the studio's name — only the single-scene detail endpoint includes
    // that. Without it, Whisparr's search results are a wall of
    // indistinguishable titles, so resolve studio names for this page of
    // results up front (deduped, best-effort — a lookup failure just leaves
    // that one studio blank rather than failing the whole search).
    const studios = await this.resolveStudioNames(
      result.scenes.map((scene) => scene.studioId),
      config,
    );

    return result.scenes.map((scene) => {
      const studio = scene.studioId ? studios.get(scene.studioId) : undefined;
      return this.mapMovieResource({
        id: scene.id,
        title: scene.title,
        details: scene.details,
        imageUrl: scene.imageUrl,
        studioId: scene.studioId,
        studioName: studio?.name ?? scene.studioName,
        studioImageUrl: studio?.imageUrl ?? scene.studioImageUrl,
        releaseDate: scene.releaseDate,
        duration: scene.duration,
        images: scene.imageUrl ? [{ id: 'poster', url: scene.imageUrl, width: null, height: null }] : [],
        studioIsFavorite: false,
        tags: [],
        performers: [],
        sourceUrls: [],
      });
    });
  }

  private async resolveStudioNames(
    studioIds: ReadonlyArray<string | null>,
    config: { baseUrl: string; apiKey: string | null },
  ): Promise<Map<string, { name: string | null; imageUrl: string | null }>> {
    const uniqueIds = [...new Set(studioIds.filter((id): id is string => !!id))];
    const resolved = new Map<string, { name: string | null; imageUrl: string | null }>();

    await Promise.all(
      uniqueIds.map(async (studioId) => {
        try {
          const studio = await this.tpdbAdapter.getStudioById(studioId, config);
          resolved.set(studioId, { name: studio.name, imageUrl: studio.imageUrl });
        } catch {
          // Best-effort — leave this studio unresolved rather than failing
          // the whole search over one bad lookup.
        }
      }),
    );

    return resolved;
  }

  async getScene(sceneId: string): Promise<unknown> {
    const config = await this.getTpdbConfig();

    try {
      const scene = await this.tpdbAdapter.getSceneById(sceneId, config);
      return this.mapMovieResource(scene);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }

      // TPDB doesn't recognize this id — most likely a scene that was
      // originally added under a since-replaced catalog provider (e.g.
      // StashDB), so its id lives in an id space TPDB has never heard of.
      // Whisparr hits this route by id when it tries to re-match an existing
      // library folder to a movie (e.g. its "Library Import" scan) — fall
      // back to whatever we cached locally for this exact id in SceneIndex,
      // so Whisparr can still re-link the folder instead of failing outright.
      const cachedScene = await this.buildSceneFromCachedIndex(sceneId);
      if (!cachedScene) {
        throw error;
      }

      return this.mapMovieResource(cachedScene);
    }
  }

  private async buildSceneFromCachedIndex(
    stashId: string,
  ): Promise<StashdbSceneDetails | null> {
    const row = await this.prisma.sceneIndex.findUnique({
      where: { stashId },
    });
    if (!row) {
      return null;
    }

    const title = row.title?.trim();
    if (!title) {
      return null;
    }

    return {
      id: stashId,
      title,
      details: row.description,
      imageUrl: row.imageUrl,
      images: row.imageUrl
        ? [{ id: 'image', url: row.imageUrl, width: null, height: null }]
        : [],
      studioId: row.studioId,
      studioIsFavorite: false,
      studioName: row.studioName,
      studioImageUrl: row.studioImageUrl,
      releaseDate: row.releaseDate,
      duration: row.duration,
      tags: [],
      performers: [],
      sourceUrls: [],
    };
  }

  async getScenesChanged(): Promise<string[]> {
    // TPDB has no confirmed "changed since" feed; reporting nothing changed
    // is the safe default Whisparr's client already handles.
    return [];
  }

  async searchPerformers(query: string): Promise<unknown[]> {
    const config = await this.getTpdbConfig();
    const result = await this.tpdbAdapter.getPerformersFeed({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: WhisparrMetadataService.SEARCH_PAGE_SIZE,
      name: query,
    });

    return result.performers.map((performer) =>
      this.mapPerformerResource({
        id: performer.id,
        name: performer.name,
        disambiguation: null,
        aliases: [],
        gender: performer.gender,
        birthDate: null,
        deathDate: null,
        age: null,
        ethnicity: null,
        country: null,
        eyeColor: null,
        hairColor: null,
        height: null,
        cupSize: null,
        bandSize: null,
        waistSize: null,
        hipSize: null,
        breastType: null,
        careerStartYear: null,
        careerEndYear: null,
        deleted: false,
        mergedIds: [],
        mergedIntoId: null,
        isFavorite: false,
        createdAt: null,
        updatedAt: null,
        imageUrl: performer.imageUrl,
        images: performer.imageUrl
          ? [{ id: 'headshot', url: performer.imageUrl, width: null, height: null }]
          : [],
      }),
    );
  }

  async getPerformer(performerId: string): Promise<unknown> {
    const config = await this.getTpdbConfig();
    const performer = await this.tpdbAdapter.getPerformerById(performerId, config);
    return this.mapPerformerResource(performer);
  }

  async getPerformerWorks(performerId: string): Promise<unknown> {
    const config = await this.getTpdbConfig();
    const result = await this.tpdbAdapter.getScenesForPerformer({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      performerId,
      page: 1,
      perPage: WhisparrMetadataService.WORKS_PAGE_SIZE,
      sort: 'DATE',
    });

    return {
      scenes: result.scenes.map((scene) => scene.id),
      tpdbMovies: [],
      movies: [],
    };
  }

  async getPerformersChanged(): Promise<string[]> {
    return [];
  }

  async searchSites(query: string): Promise<unknown[]> {
    const config = await this.getTpdbConfig();
    const result = await this.tpdbAdapter.getStudiosFeed({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: WhisparrMetadataService.SEARCH_PAGE_SIZE,
      name: query,
    });

    return result.studios.map((studio) =>
      this.mapStudioResource({
        id: studio.id,
        name: studio.name,
        aliases: [],
        deleted: false,
        isFavorite: false,
        createdAt: null,
        updatedAt: null,
        imageUrl: studio.imageUrl,
        images: studio.imageUrl
          ? [{ id: 'logo', url: studio.imageUrl, width: null, height: null }]
          : [],
        urls: [],
        parentStudio: studio.parentStudio
          ? { ...studio.parentStudio, aliases: [], isFavorite: false, urls: [] }
          : null,
        childStudios: [],
      }),
    );
  }

  async getSite(siteId: string): Promise<unknown> {
    const config = await this.getTpdbConfig();
    const studio = await this.tpdbAdapter.getStudioById(siteId, config);
    return this.mapStudioResource(studio);
  }

  async getSiteScenes(siteId: string): Promise<string[]> {
    const config = await this.getTpdbConfig();
    const result = await this.tpdbAdapter.getScenesBySort({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      page: 1,
      perPage: WhisparrMetadataService.WORKS_PAGE_SIZE,
      sort: 'DATE',
      studioIds: [siteId],
    });

    return result.scenes.map((scene) => scene.id);
  }

  async getSiteWorks(siteId: string): Promise<unknown> {
    const scenes = await this.getSiteScenes(siteId);
    return { scenes, tpdbMovies: [], movies: [] };
  }

  async getSitesChanged(): Promise<string[]> {
    return [];
  }

  private async getTpdbConfig(): Promise<{ baseUrl: string; apiKey: string | null }> {
    const integration = await this.integrationsService.findOne(IntegrationType.TPDB);
    const baseUrl = integration?.baseUrl?.trim();

    if (!integration || !integration.enabled || integration.status !== IntegrationStatus.CONFIGURED || !baseUrl) {
      throw new ServiceUnavailableException('TPDB integration is not configured.');
    }

    return { baseUrl, apiKey: integration.apiKey };
  }

  private mapForeignIds(id: string): { stashId: string; tmdbId: number; tpdbId: string } {
    return { stashId: id, tmdbId: 0, tpdbId: id };
  }

  private mapImages(images: StashdbSceneImage[]): Array<{ coverType: string; url: string }> {
    return images.map((image) => ({ coverType: this.coverTypeForImageId(image.id), url: image.url }));
  }

  private coverTypeForImageId(id: string): string {
    switch (id) {
      case 'poster':
        return 'poster';
      case 'background':
        return 'fanart';
      case 'logo':
        return 'clearlogo';
      case 'image':
      case 'thumbnail':
      case 'face':
      case 'headshot':
        return 'headshot';
      default:
        return 'poster';
    }
  }

  private mapMovieResource(scene: StashdbSceneDetails): unknown {
    const studio =
      scene.studioId && scene.studioName
        ? this.mapStudioResource({
            id: scene.studioId,
            name: scene.studioName,
            aliases: [],
            deleted: false,
            isFavorite: false,
            createdAt: null,
            updatedAt: null,
            imageUrl: scene.studioImageUrl,
            images: scene.studioImageUrl
              ? [{ id: 'logo', url: scene.studioImageUrl, width: null, height: null }]
              : [],
            urls: [],
            parentStudio: null,
            childStudios: [],
          })
        : null;

    return {
      foreignIds: this.mapForeignIds(scene.id),
      overview: scene.details,
      title: scene.title,
      slug: null,
      ratings: null,
      duration: scene.duration,
      images: this.mapImages(scene.images),
      genres: scene.tags.map((tag) => tag.name),
      code: null,
      year: scene.releaseDate ? new Date(scene.releaseDate).getUTCFullYear() : 0,
      releaseDate: scene.releaseDate,
      releaseDateUtc: scene.releaseDate,
      alternativeTitles: [],
      credits: scene.performers.map((performer, index) => this.mapCastResource(performer, index)),
      studio,
      homepage: scene.sourceUrls[0]?.url ?? null,
      itemType: 'scene',
    };
  }

  private mapCastResource(performer: StashdbScenePerformer, order: number): unknown {
    return {
      order,
      character: null,
      creditId: null,
      performer: this.mapPerformerResource({
        id: performer.id,
        name: performer.name,
        disambiguation: null,
        aliases: [],
        gender: performer.gender,
        birthDate: null,
        deathDate: null,
        age: null,
        ethnicity: null,
        country: null,
        eyeColor: null,
        hairColor: null,
        height: null,
        cupSize: null,
        bandSize: null,
        waistSize: null,
        hipSize: null,
        breastType: null,
        careerStartYear: null,
        careerEndYear: null,
        deleted: false,
        mergedIds: [],
        mergedIntoId: null,
        isFavorite: false,
        createdAt: null,
        updatedAt: null,
        imageUrl: performer.imageUrl,
        images: performer.imageUrl
          ? [{ id: 'headshot', url: performer.imageUrl, width: null, height: null }]
          : [],
      }),
    };
  }

  private mapPerformerResource(
    performer: Omit<StashdbPerformerDetails, 'gender'> & { gender: string | null },
  ): unknown {
    return {
      name: performer.name,
      foreignIds: this.mapForeignIds(performer.id),
      images: this.mapImages(performer.images),
      gender: performer.gender,
      ethnicity: null,
      status: 'active',
      mergedIntoId: null,
      age: null,
      careerStart: null,
      careerEnd: null,
      hairColor: null,
    };
  }

  private mapStudioResource(studio: StashdbStudioDetails): unknown {
    return {
      title: studio.name,
      aliases: studio.aliases,
      homepage: studio.urls[0]?.url ?? null,
      network: studio.parentStudio?.name ?? null,
      status: 'active',
      images: this.mapImages(studio.images),
      foreignIds: this.mapForeignIds(studio.id),
    };
  }
}
