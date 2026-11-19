import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CatalogProviderService,
  type ConfiguredCatalogProvider,
} from './catalog-provider.service';
import {
  CatalogSnapshotService,
  isCatalogOutage,
  type CatalogSnapshotKind,
} from './catalog-snapshot.service';

interface DueSnapshot {
  kind: CatalogSnapshotKind;
  id: string;
}

/**
 * Keeps a stored copy of the catalog record behind everything in the
 * library: each library scene matched to the catalog, then the performers
 * and studio credited on those scenes. A few at a time, so the provider is
 * never hurried; copies are refreshed once they're a couple of weeks old.
 * Stops for the minute whenever the provider can't be reached.
 */
@Injectable()
export class CatalogSnapshotBackfillService {
  /** Records fetched each minute. */
  static readonly PER_RUN = 10;
  /** A stored copy older than this is fetched again. */
  static readonly REFRESH_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

  private readonly logger = new Logger(CatalogSnapshotBackfillService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly snapshots: CatalogSnapshotService,
  ) {}

  @Interval(60_000)
  async handleInterval(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.warn(
        `Catalog snapshot backfill failed: ${(error as Error)?.message ?? 'Unknown error.'}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** One round: returns how many records were stored. */
  async run(): Promise<number> {
    const provider =
      await this.catalogProviderService.getConfiguredCatalogProviderOrNull();
    if (!provider || this.snapshots.inOutage(provider.providerKey)) {
      return 0;
    }

    const due = await this.dueSnapshots(
      provider.providerKey,
      CatalogSnapshotBackfillService.PER_RUN,
    );
    let stored = 0;
    for (const item of due) {
      const outcome = await this.fetchOne(provider, item);
      if (outcome === 'outage') {
        break;
      }
      if (outcome === 'stored') {
        stored += 1;
      }
    }
    return stored;
  }

  private async fetchOne(
    provider: ConfiguredCatalogProvider,
    item: DueSnapshot,
  ): Promise<'stored' | 'missing' | 'outage'> {
    const adapter = this.catalogProviderService.catalogAdapterFor(provider);
    const config = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
    try {
      const data =
        item.kind === 'SCENE'
          ? await adapter.getSceneById(item.id, config)
          : item.kind === 'PERFORMER'
            ? await adapter.getPerformerById(item.id, config)
            : await adapter.getStudioById(item.id, config);
      await this.snapshots.save(provider.providerKey, item.kind, item.id, data);
      return 'stored';
    } catch (error) {
      if (isCatalogOutage(error)) {
        this.snapshots.noteOutage(provider.providerKey);
        return 'outage';
      }
      // Not there (or not askable): left for the next refresh, not retried every minute.
      if (!(error instanceof NotFoundException)) {
        this.logger.debug(
          `Catalog ${item.kind.toLowerCase()} ${item.id} not stored: ${(error as Error)?.message}`,
        );
      }
      await this.snapshots.markMissing(
        provider.providerKey,
        item.kind,
        item.id,
      );
      return 'missing';
    }
  }

  /**
   * What to fetch next: library scenes without a (recent) copy first, then
   * the performers and studios on the library scenes already stored.
   */
  private async dueSnapshots(
    provider: string,
    limit: number,
  ): Promise<DueSnapshot[]> {
    const staleBefore = new Date(
      Date.now() - CatalogSnapshotBackfillService.REFRESH_AFTER_MS,
    );
    const scenes = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT l.id
      FROM (
        SELECT DISTINCT "linkedStashId" AS id
        FROM "LibrarySceneIndex"
        WHERE "linkedStashId" IS NOT NULL AND "linkedStashId" <> ''
      ) l
      LEFT JOIN "CatalogSnapshot" s
        ON s.provider = ${provider} AND s.kind = 'SCENE' AND s."catalogId" = l.id
      WHERE s."catalogId" IS NULL OR s."fetchedAt" < ${staleBefore}
      ORDER BY s."fetchedAt" ASC NULLS FIRST
      LIMIT ${limit}
    `;
    const due: DueSnapshot[] = scenes.map(({ id }) => ({ kind: 'SCENE', id }));
    if (due.length >= limit) {
      return due;
    }

    const credits = await this.prisma.$queryRaw<
      Array<{ kind: 'PERFORMER' | 'STUDIO'; id: string }>
    >`
      WITH library AS (
        SELECT s.data
        FROM "CatalogSnapshot" s
        JOIN (
          SELECT DISTINCT "linkedStashId" AS id
          FROM "LibrarySceneIndex"
          WHERE "linkedStashId" IS NOT NULL
        ) l ON l.id = s."catalogId"
        WHERE s.provider = ${provider} AND s.kind = 'SCENE' AND s.data IS NOT NULL
      ),
      credits AS (
        SELECT 'PERFORMER' AS kind, p->>'id' AS id
        FROM library
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(library.data->'performers') = 'array'
            THEN library.data->'performers' ELSE '[]'::jsonb END
        ) p
        UNION
        SELECT 'STUDIO' AS kind, library.data->>'studioId' AS id
        FROM library
      )
      SELECT c.kind, c.id
      FROM credits c
      LEFT JOIN "CatalogSnapshot" t
        ON t.provider = ${provider} AND t.kind = c.kind AND t."catalogId" = c.id
      WHERE c.id IS NOT NULL AND c.id <> ''
        AND (t."catalogId" IS NULL OR t."fetchedAt" < ${staleBefore})
      ORDER BY t."fetchedAt" ASC NULLS FIRST, c.kind DESC
      LIMIT ${limit - due.length}
    `;
    return [...due, ...credits];
  }
}
