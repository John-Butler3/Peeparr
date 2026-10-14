import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MonitoredPerformer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { RequestsService } from '../requests/requests.service';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AppSettingsService } from '../settings/app-settings.service';

export interface PerformerMonitoringState {
  monitored: boolean;
  monitoredSince: string | null;
}

/**
 * Monitors a performer for scenes released AFTER monitoring was switched on.
 * Whisparr's own performer monitoring pulls the performer's entire back
 * catalog, so this is tracked in the portal instead: a scene is only ever
 * auto-requested when its release date is on/after the day monitoring
 * started. Past scenes are never requested, and a scene with no release date
 * is skipped since it can't be shown to be upcoming.
 */
@Injectable()
export class PerformerMonitoringService {
  private static readonly SCENES_PER_PAGE = 50;
  // Scenes come back newest-first, so a handful of pages is far more than
  // enough to reach the cutoff; this just bounds a misbehaving provider.
  private static readonly MAX_PAGES = 5;

  private readonly logger = new Logger(PerformerMonitoringService.name);
  private checking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly sceneStatusService: SceneStatusService,
    private readonly appSettingsService: AppSettingsService,
    private readonly requestsService: RequestsService,
  ) {}

  async getState(performerId: string): Promise<PerformerMonitoringState> {
    const row = await this.prisma.monitoredPerformer.findUnique({
      where: { performerId: performerId.trim() },
    });

    return this.toState(row);
  }

  async setMonitored(
    performerId: string,
    monitored: boolean,
  ): Promise<PerformerMonitoringState> {
    const normalizedId = performerId.trim();

    if (!monitored) {
      await this.prisma.monitoredPerformer.deleteMany({
        where: { performerId: normalizedId },
      });
      return this.toState(null);
    }

    const existing = await this.prisma.monitoredPerformer.findUnique({
      where: { performerId: normalizedId },
    });
    if (existing) {
      return this.toState(existing);
    }

    const created = await this.prisma.monitoredPerformer.create({
      data: { performerId: normalizedId },
    });

    // A scene dated today counts as upcoming, so look right away rather than
    // waiting for the next scheduled pass.
    void this.checkPerformer(created).catch((error: unknown) => {
      this.logger.warn(
        `Initial monitor check failed for performer ${normalizedId}: ${this.describe(error)}`,
      );
    });

    return this.toState(created);
  }

  @Interval(6 * 60 * 60_000)
  async handleScheduledCheck(): Promise<void> {
    await this.checkAll();
  }

  async checkAll(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const rows = await this.prisma.monitoredPerformer.findMany();
      for (const row of rows) {
        try {
          await this.checkPerformer(row);
        } catch (error) {
          this.logger.warn(
            `Monitor check failed for performer ${row.performerId}: ${this.describe(error)}`,
          );
        }
      }
    } finally {
      this.checking = false;
    }
  }

  async checkPerformer(row: MonitoredPerformer): Promise<number> {
    const cutoff = this.startOfUtcDay(row.monitoredSince);
    const upcoming = await this.findScenesReleasedSince(row.performerId, cutoff);
    const unhandled = upcoming.filter(
      (sceneId) => !row.handledSceneIds.includes(sceneId),
    );

    let requested = 0;
    if (unhandled.length > 0) {
      const statuses = await this.sceneStatusService.resolveForScenes(unhandled);
      const settings = await this.appSettingsService.get();
      const canRequest =
        !!settings.defaultRootFolderPath && !!settings.defaultQualityProfileId;
      const handledNow: string[] = [];

      for (const sceneId of unhandled) {
        const state = statuses.get(sceneId)?.state ?? 'NOT_REQUESTED';
        if (state !== 'NOT_REQUESTED') {
          // Already requested/downloading/available some other way.
          handledNow.push(sceneId);
          continue;
        }

        if (!canRequest) {
          // Leave it unhandled so it's picked up once defaults are saved.
          this.logger.warn(
            'Performer monitoring needs a default root folder and quality profile in Settings > Content before it can request scenes.',
          );
          break;
        }

        try {
          await this.requestsService.submitSceneRequest(sceneId, {
            monitored: settings.defaultMonitored,
            rootFolderPath: settings.defaultRootFolderPath!,
            searchForMovie: settings.defaultSearchForMovie,
            qualityProfileId: settings.defaultQualityProfileId!,
            tags: settings.defaultTagIds,
          });
          handledNow.push(sceneId);
          requested += 1;
        } catch (error) {
          // Retry on the next pass rather than marking it handled.
          this.logger.warn(
            `Auto-request failed for scene ${sceneId}: ${this.describe(error)}`,
          );
        }
      }

      await this.prisma.monitoredPerformer.update({
        where: { id: row.id },
        data: {
          handledSceneIds: [...row.handledSceneIds, ...handledNow],
          lastCheckedAt: new Date(),
        },
      });
    } else {
      await this.prisma.monitoredPerformer.update({
        where: { id: row.id },
        data: { lastCheckedAt: new Date() },
      });
    }

    if (requested > 0) {
      this.logger.log(
        `Requested ${requested} new scene(s) for monitored performer ${row.performerId}`,
      );
    }

    return requested;
  }

  private async findScenesReleasedSince(
    performerId: string,
    cutoff: Date,
  ): Promise<string[]> {
    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const catalogAdapter =
      await this.catalogProviderService.getConfiguredCatalogAdapter();

    const sceneIds: string[] = [];
    for (let page = 1; page <= PerformerMonitoringService.MAX_PAGES; page += 1) {
      const result = await catalogAdapter.getScenesForPerformer({
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
        performerId,
        page,
        perPage: PerformerMonitoringService.SCENES_PER_PAGE,
        sort: 'DATE',
        direction: 'DESC',
      });

      let reachedPast = false;
      for (const scene of result.scenes) {
        const released = this.parseReleaseDate(scene.releaseDate ?? scene.date);
        if (released === null) {
          continue;
        }

        if (released.getTime() >= cutoff.getTime()) {
          sceneIds.push(scene.id);
        } else {
          reachedPast = true;
        }
      }

      const hasMore = page * PerformerMonitoringService.SCENES_PER_PAGE < result.total;
      if (reachedPast || !hasMore || result.scenes.length === 0) {
        break;
      }
    }

    return sceneIds;
  }

  private parseReleaseDate(value: string | null): Date | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private startOfUtcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private toState(row: MonitoredPerformer | null): PerformerMonitoringState {
    return {
      monitored: row !== null,
      monitoredSince: row ? row.monitoredSince.toISOString() : null,
    };
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
