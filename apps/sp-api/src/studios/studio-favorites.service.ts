import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Locally-tracked studio favorites, the studio counterpart of
 * PerformerFavoritesService: TPDB never reports a per-user favorite on its
 * sites, so this table is what makes the Favorite star (and favorite-studio
 * filtering) work there. A studio counts as a favorite if the catalog
 * provider or this table says so; the provider's own favorite call is still
 * made best-effort.
 */
@Injectable()
export class StudioFavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async getFavoriteIds(studioIds: string[]): Promise<Set<string>> {
    if (studioIds.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.favoriteStudio.findMany({
      where: { studioId: { in: studioIds } },
      select: { studioId: true },
    });

    return new Set(rows.map((row) => row.studioId));
  }

  async listAllFavoriteIds(): Promise<string[]> {
    const rows = await this.prisma.favoriteStudio.findMany({
      select: { studioId: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => row.studioId);
  }

  async setFavorite(
    studioId: string,
    favorite: boolean,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    const existing = await this.prisma.favoriteStudio.findUnique({ where: { studioId } });
    const alreadyFavorited = existing !== null;

    if (favorite && !alreadyFavorited) {
      await this.prisma.favoriteStudio.create({ data: { studioId } });
    } else if (!favorite && alreadyFavorited) {
      await this.prisma.favoriteStudio.delete({ where: { studioId } });
    }

    return { favorited: favorite, alreadyFavorited };
  }
}
