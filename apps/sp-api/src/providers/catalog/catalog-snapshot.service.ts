import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type CatalogSnapshotKind = 'SCENE' | 'PERFORMER' | 'STUDIO';

/**
 * The provider couldn't be asked: unreachable, timed out, or a 5xx (the
 * adapters turn all of those into a 502). A 404 or a bad request is an
 * answer, not an outage.
 */
export function isCatalogOutage(error: unknown): boolean {
  return !(error instanceof HttpException) || error.getStatus() >= 500;
}

/**
 * Catalog records (a scene, performer or studio, as the adapter returns it)
 * kept in the database, so their pages still open while the provider is
 * down. Every lookup made through the catalog adapter stores what came
 * back; when the provider can't be reached, the stored copy answers instead.
 *
 * After a failed call, the provider is left alone for a while: stored copies
 * answer straight away rather than each page waiting out its timeout.
 */
@Injectable()
export class CatalogSnapshotService {
  /** How long stored copies answer straight away after the provider failed. */
  static readonly OUTAGE_HOLD_MS = 60_000;

  private readonly logger = new Logger(CatalogSnapshotService.name);
  private readonly outageUntil = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /** Fetched live and stored; the stored copy when the provider is down. */
  async through<T>(
    provider: string,
    kind: CatalogSnapshotKind,
    catalogId: string,
    fetch: () => Promise<T>,
  ): Promise<T> {
    const id = catalogId.trim();
    if (this.inOutage(provider)) {
      const stored = await this.load<T>(provider, kind, id);
      if (stored !== null) {
        return stored;
      }
    }

    let fresh: T;
    try {
      fresh = await fetch();
    } catch (error) {
      if (!id || !isCatalogOutage(error)) {
        throw error;
      }
      this.noteOutage(provider);
      const stored = await this.load<T>(provider, kind, id);
      if (stored === null) {
        throw error;
      }
      this.logger.warn(
        `${provider} unavailable: ${kind.toLowerCase()} ${id} served from its stored copy.`,
      );
      return stored;
    }

    this.outageUntil.delete(provider);
    if (id) {
      await this.save(provider, kind, id, fresh);
    }
    return fresh;
  }

  inOutage(provider: string): boolean {
    const until = this.outageUntil.get(provider);
    if (until === undefined) {
      return false;
    }
    if (Date.now() >= until) {
      this.outageUntil.delete(provider);
      return false;
    }
    return true;
  }

  noteOutage(provider: string): void {
    this.outageUntil.set(
      provider,
      Date.now() + CatalogSnapshotService.OUTAGE_HOLD_MS,
    );
  }

  async load<T>(
    provider: string,
    kind: CatalogSnapshotKind,
    catalogId: string,
  ): Promise<T | null> {
    try {
      const row = await this.prisma.catalogSnapshot.findUnique({
        where: { provider_kind_catalogId: { provider, kind, catalogId } },
        select: { data: true },
      });
      return (row?.data ?? null) as T | null;
    } catch (error) {
      this.logger.warn(
        `Couldn't read the stored ${kind.toLowerCase()} ${catalogId}: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  /** Stores what the provider returned; never fails the caller. */
  async save(
    provider: string,
    kind: CatalogSnapshotKind,
    catalogId: string,
    data: unknown,
  ): Promise<void> {
    await this.write(
      provider,
      kind,
      catalogId,
      data == null ? Prisma.DbNull : toJson(data),
    );
  }

  /** The provider says there's no such record: not asked again for a while. */
  async markMissing(
    provider: string,
    kind: CatalogSnapshotKind,
    catalogId: string,
  ): Promise<void> {
    await this.write(provider, kind, catalogId, Prisma.DbNull);
  }

  private async write(
    provider: string,
    kind: CatalogSnapshotKind,
    catalogId: string,
    data: Prisma.InputJsonValue | typeof Prisma.DbNull,
  ): Promise<void> {
    const fetchedAt = new Date();
    try {
      await this.prisma.catalogSnapshot.upsert({
        where: { provider_kind_catalogId: { provider, kind, catalogId } },
        create: { provider, kind, catalogId, data, fetchedAt },
        update: { data, fetchedAt },
      });
    } catch (error) {
      this.logger.warn(
        `Couldn't store the ${kind.toLowerCase()} ${catalogId}: ${(error as Error)?.message}`,
      );
    }
  }
}

function toJson(data: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}
