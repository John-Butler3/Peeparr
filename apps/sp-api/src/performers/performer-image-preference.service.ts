import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A locally-saved "main image" override for a catalog-provider performer,
 * independent of which catalog provider (StashDB/FansDB/TPDB) is active.
 * The provider itself has no concept of a user-chosen primary image, so this
 * table is the only source of truth for the override; callers are expected
 * to validate the saved URL is still one of the performer's current images
 * before trusting it (a provider's gallery can change over time).
 */
@Injectable()
export class PerformerImagePreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async getMainImageUrl(performerId: string): Promise<string | null> {
    const row = await this.prisma.performerImagePreference.findUnique({
      where: { performerId },
    });
    return row?.mainImageUrl ?? null;
  }

  /**
   * Batched lookup for feeds/cast lists that carry many performers at once,
   * to avoid one round-trip per performer.
   */
  async getMainImageUrls(performerIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(performerIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.performerImagePreference.findMany({
      where: { performerId: { in: uniqueIds } },
    });

    return new Map(rows.map((row) => [row.performerId, row.mainImageUrl]));
  }

  async setMainImage(performerId: string, imageUrl: string): Promise<void> {
    await this.prisma.performerImagePreference.upsert({
      where: { performerId },
      create: { performerId, mainImageUrl: imageUrl },
      update: { mainImageUrl: imageUrl },
    });
  }
}
