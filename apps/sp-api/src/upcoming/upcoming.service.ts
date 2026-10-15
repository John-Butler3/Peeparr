import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogAdapter } from '../providers/catalog/catalog-adapter.interface';
import {
  CatalogProviderService,
  ConfiguredCatalogProvider,
} from '../providers/catalog/catalog-provider.service';
import { StashdbScene } from '../providers/stashdb/stashdb.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { isSceneStatusRequestable } from '../scene-status/dto/scene-status.dto';
import { filterExcludedNetworkScenes } from '../scene-status/exclude-network-scenes.util';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AppSettingsService } from '../settings/app-settings.service';
import { UpcomingItemDto, UpcomingReasonDto, UpcomingResponseDto } from './dto/upcoming.dto';

interface FoundScene {
  scene: StashdbScene;
  releaseDate: string;
  reasons: UpcomingReasonDto[];
}

/**
 * What's coming up: scenes you've requested that aren't out yet, and new
 * releases from your favourite performers and sites. Requested scenes come
 * from the local scene index; favourites' scenes from the catalog, walking
 * each favourite's scenes newest-first until they're in the past.
 */
@Injectable()
export class UpcomingService {
  /** Recent releases stay on the calendar this long. */
  static readonly PAST_DAYS = 7;
  /** How far ahead to look. */
  static readonly FUTURE_DAYS = 180;
  private static readonly PER_PAGE = 40;
  private static readonly MAX_PAGES = 3;
  private static readonly CONCURRENCY = 3;
  /** Catalog lookups are cached this long; requested scenes are always fresh. */
  private static readonly CACHE_MS = 30 * 60_000;

  private readonly logger = new Logger(UpcomingService.name);
  private cache: { key: string; at: number; scenes: FoundScene[] } | null = null;
  private readonly performerNames = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly sceneStatusService: SceneStatusService,
    private readonly appSettingsService: AppSettingsService,
  ) {}

  async getUpcoming(now = new Date()): Promise<UpcomingResponseDto> {
    const from = this.isoDate(this.addDays(now, -UpcomingService.PAST_DAYS));
    const to = this.isoDate(this.addDays(now, UpcomingService.FUTURE_DAYS));

    const [favourites, requested, appSettings, provider] = await Promise.all([
      this.favouriteScenes(from, to),
      this.requestedScenes(from, to),
      this.appSettingsService.get(),
      this.catalogProviderService.getConfiguredCatalogProvider().catch(() => null),
    ]);

    // One entry per scene, with every reason it's on the calendar.
    const byId = new Map<string, FoundScene>();
    for (const found of [...requested, ...favourites]) {
      const existing = byId.get(found.scene.id);
      if (!existing) {
        byId.set(found.scene.id, { ...found, reasons: [...found.reasons] });
        continue;
      }
      for (const reason of found.reasons) {
        if (!existing.reasons.some((r) => r.kind === reason.kind && r.id === reason.id)) {
          existing.reasons.push(reason);
        }
      }
    }

    const all = [...byId.values()];
    const statuses = await this.sceneStatusService.resolveForScenes(all.map((f) => f.scene.id));
    const visibleIds = new Set(
      filterExcludedNetworkScenes(
        all.map((f) => f.scene),
        statuses,
        appSettings.hideAmateurNetworkResults,
      ).map((scene) => scene.id),
    );

    const items: UpcomingItemDto[] = all
      .filter((found) => visibleIds.has(found.scene.id))
      .map((found) => {
        const status = statuses.get(found.scene.id) ?? { state: 'NOT_REQUESTED' as const };
        // Anything you've asked for counts as requested, whatever the reason it's here.
        const reasons =
          status.state !== 'NOT_REQUESTED' && !found.reasons.some((r) => r.kind === 'REQUESTED')
            ? [{ kind: 'REQUESTED' as const, id: null, name: null }, ...found.reasons]
            : found.reasons;
        return {
          id: found.scene.id,
          title: found.scene.title,
          description: found.scene.details,
          imageUrl: found.scene.imageUrl,
          cardImageUrl: withStashImageSize(found.scene.imageUrl, 600),
          studioId: found.scene.studioId,
          studio: found.scene.studioName,
          studioImageUrl: found.scene.studioImageUrl,
          releaseDate: found.releaseDate,
          duration: found.scene.duration,
          type: 'SCENE' as const,
          source: provider?.integrationType ?? 'STASHDB',
          status,
          requestable: isSceneStatusRequestable(status),
          reasons,
        };
      })
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title));

    return { from, to, today: this.isoDate(now), items };
  }

  /** Requested scenes with a release date in the window, from the scene index. */
  private async requestedScenes(from: string, to: string): Promise<FoundScene[]> {
    const rows = await this.prisma.sceneIndex.findMany({
      where: {
        requestStatus: { not: null },
        releaseDate: { gte: from, lte: `${to}￿` },
      },
      take: 500,
    });

    return rows.flatMap((row) => {
      const releaseDate = this.dateOnly(row.releaseDate);
      if (!releaseDate || releaseDate < from || releaseDate > to) {
        return [];
      }
      return [
        {
          releaseDate,
          reasons: [{ kind: 'REQUESTED' as const, id: null, name: null }],
          scene: {
            id: row.stashId,
            title: row.title ?? 'Untitled scene',
            details: row.description,
            imageUrl: row.imageUrl,
            studioId: row.studioId,
            studioName: row.studioName,
            studioImageUrl: row.studioImageUrl,
            date: row.releaseDate,
            releaseDate: row.releaseDate,
            productionDate: null,
            duration: row.duration,
            isFromExcludedNetwork: false,
          },
        },
      ];
    });
  }

  /** Favourite performers' and sites' releases in the window, cached. */
  private async favouriteScenes(from: string, to: string): Promise<FoundScene[]> {
    const [performers, studios] = await Promise.all([
      this.prisma.favoritePerformer.findMany({ select: { performerId: true } }),
      this.prisma.favoriteStudio.findMany({ select: { studioId: true } }),
    ]);
    if (performers.length === 0 && studios.length === 0) {
      return [];
    }

    const key = [
      from,
      performers.map((p) => p.performerId).sort().join(','),
      studios.map((s) => s.studioId).sort().join(','),
    ].join('|');
    if (this.cache && this.cache.key === key && Date.now() - this.cache.at < UpcomingService.CACHE_MS) {
      return this.cache.scenes;
    }

    let provider: ConfiguredCatalogProvider;
    let adapter: CatalogAdapter;
    try {
      provider = await this.catalogProviderService.getConfiguredCatalogProvider();
      adapter = await this.catalogProviderService.getConfiguredCatalogAdapter();
    } catch {
      return [];
    }
    const base = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };

    const jobs: Array<() => Promise<FoundScene[]>> = [
      ...performers.map(({ performerId }) => async () => {
        const name = await this.performerName(adapter, base, performerId);
        const scenes = await this.walk(from, to, (page) =>
          adapter.getScenesForPerformer({
            ...base,
            performerId,
            page,
            perPage: UpcomingService.PER_PAGE,
            sort: 'DATE',
            direction: 'DESC',
          }),
        );
        return scenes.map((found) => ({
          ...found,
          reasons: [{ kind: 'PERFORMER' as const, id: performerId, name }],
        }));
      }),
      ...studios.map(({ studioId }) => async () => {
        const scenes = await this.walk(from, to, (page) =>
          adapter.getScenesBySort({
            ...base,
            page,
            perPage: UpcomingService.PER_PAGE,
            sort: 'DATE',
            direction: 'DESC',
            studioIds: [studioId],
          }),
        );
        return scenes.map((found) => ({
          ...found,
          reasons: [{ kind: 'STUDIO' as const, id: studioId, name: found.scene.studioName }],
        }));
      }),
    ];

    const results = await this.runLimited(jobs, UpcomingService.CONCURRENCY);
    const scenes = results.flat();
    this.cache = { key, at: Date.now(), scenes };
    return scenes;
  }

  // Newest first: keep scenes in the window, stop once they're older than it.
  private async walk(
    from: string,
    to: string,
    fetchPage: (page: number) => Promise<{ scenes: StashdbScene[]; total: number }>,
  ): Promise<Array<Omit<FoundScene, 'reasons'>>> {
    const found: Array<Omit<FoundScene, 'reasons'>> = [];
    for (let page = 1; page <= UpcomingService.MAX_PAGES; page += 1) {
      const result = await fetchPage(page);
      let reachedPast = false;
      for (const scene of result.scenes) {
        const releaseDate = this.dateOnly(scene.releaseDate ?? scene.date ?? scene.productionDate);
        if (!releaseDate) {
          continue;
        }
        if (releaseDate < from) {
          reachedPast = true;
        } else if (releaseDate <= to) {
          found.push({ scene, releaseDate });
        }
      }
      if (reachedPast || result.scenes.length === 0 || page * UpcomingService.PER_PAGE >= result.total) {
        break;
      }
    }
    return found;
  }

  private async performerName(
    adapter: CatalogAdapter,
    base: { baseUrl: string; apiKey: string | null },
    performerId: string,
  ): Promise<string | null> {
    if (!this.performerNames.has(performerId)) {
      try {
        const performer = await adapter.getPerformerById(performerId, base);
        this.performerNames.set(performerId, performer.name);
      } catch {
        return null;
      }
    }
    return this.performerNames.get(performerId) ?? null;
  }

  // A favourite that fails to load is left out rather than failing the page.
  private async runLimited<T>(jobs: Array<() => Promise<T[]>>, limit: number): Promise<T[][]> {
    const results: T[][] = new Array(jobs.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, jobs.length) }, async () => {
        while (next < jobs.length) {
          const index = next++;
          try {
            results[index] = await jobs[index]();
          } catch (error) {
            this.logger.warn(
              `Couldn't load upcoming scenes for a favourite: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
            results[index] = [];
          }
        }
      }),
    );
    return results;
  }

  private dateOnly(value: string | null | undefined): string | null {
    return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
  }

  private isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
