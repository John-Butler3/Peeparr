import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Locally-tracked performer favorites. TPDB's REST performer endpoints never
 * report a per-user favorite flag (confirmed live: the field is absent even
 * on an otherwise-complete performer resource) despite exposing a
 * favoritePerformer GraphQL mutation, so relying on the catalog provider as
 * the source of truth silently breaks both the isFavorite badge and
 * favorites-only filtering. This table is authoritative regardless of which
 * catalog provider is active; the provider's own favorite mutation is still
 * called best-effort for parity with other tools sharing that account.
 */
@Injectable()
export class PerformerFavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async isFavorite(performerId: string): Promise<boolean> {
    const row = await this.prisma.favoritePerformer.findUnique({
      where: { performerId },
    });
    return row !== null;
  }

  async getFavoriteIds(performerIds: string[]): Promise<Set<string>> {
    if (performerIds.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.favoritePerformer.findMany({
      where: { performerId: { in: performerIds } },
      select: { performerId: true },
    });

    return new Set(rows.map((row) => row.performerId));
  }

  async listAllFavoriteIds(): Promise<string[]> {
    const rows = await this.prisma.favoritePerformer.findMany({
      select: { performerId: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => row.performerId);
  }

  async setFavorite(
    performerId: string,
    favorite: boolean,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    const existing = await this.prisma.favoritePerformer.findUnique({
      where: { performerId },
    });
    const alreadyFavorited = existing !== null;

    if (favorite && !alreadyFavorited) {
      await this.prisma.favoritePerformer.create({ data: { performerId } });
    } else if (!favorite && alreadyFavorited) {
      await this.prisma.favoritePerformer.delete({ where: { performerId } });
    }

    return { favorited: favorite, alreadyFavorited };
  }
}
