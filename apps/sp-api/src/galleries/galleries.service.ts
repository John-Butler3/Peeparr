import { Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  StashAdapter,
  StashAdapterBaseConfig,
  StashLocalGalleryFeedItem,
} from '../providers/stash/stash.adapter';
import { GalleriesFeedResponseDto } from './dto/galleries-feed-response.dto';
import { GalleryFeedItemDto } from './dto/gallery-feed-item.dto';
import { GalleryFilterOptionDto } from './dto/gallery-filter-option.dto';
import { GalleryImagesFeedDto } from './dto/gallery-images-feed.dto';

@Injectable()
export class GalleriesService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;
  private static readonly DEFAULT_IMAGES_PER_PAGE = 40;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashAdapter: StashAdapter,
  ) {}

  async getGalleriesFeed(
    page = GalleriesService.DEFAULT_PAGE,
    perPage = GalleriesService.DEFAULT_PER_PAGE,
    filters?: {
      query?: string;
      tagIds?: string[];
      studioIds?: string[];
    },
  ): Promise<GalleriesFeedResponseDto> {
    const config = await this.getStashConfig();
    const result = await this.stashAdapter.getLocalGalleryFeed(config, {
      page,
      perPage,
      titleQuery: filters?.query,
      tagIds: this.normalizeIds(filters?.tagIds ?? []),
      studioIds: this.normalizeIds(filters?.studioIds ?? []),
    });

    return {
      total: result.total,
      page: result.page,
      perPage: result.perPage,
      hasMore: result.hasMore,
      items: result.items.map((gallery) => this.toGalleryFeedItemDto(gallery)),
    };
  }

  async getGalleryById(galleryId: string): Promise<GalleryFeedItemDto> {
    const normalizedGalleryId = galleryId.trim();
    if (!normalizedGalleryId) {
      throw new NotFoundException('Gallery id is required.');
    }

    const config = await this.getStashConfig();
    const gallery = await this.stashAdapter.getGalleryById(
      normalizedGalleryId,
      config,
    );

    if (!gallery) {
      throw new NotFoundException(`Gallery ${normalizedGalleryId} not found.`);
    }

    return this.toGalleryFeedItemDto(gallery);
  }

  async getGalleryImages(
    galleryId: string,
    page = GalleriesService.DEFAULT_PAGE,
    perPage = GalleriesService.DEFAULT_IMAGES_PER_PAGE,
  ): Promise<GalleryImagesFeedDto> {
    const normalizedGalleryId = galleryId.trim();
    if (!normalizedGalleryId) {
      throw new NotFoundException('Gallery id is required.');
    }

    const config = await this.getStashConfig();
    const result = await this.stashAdapter.getGalleryImages(
      normalizedGalleryId,
      config,
      { page, perPage },
    );

    return {
      ...result,
      // Proxied through this app's own (HTTPS) backend rather than Stash's
      // raw URL directly -- Stash is commonly only reachable over plain
      // HTTP, which browsers block as mixed content on an HTTPS page.
      items: result.items.map((image) => ({
        ...image,
        thumbnailUrl: `/api/media/stash/images/${encodeURIComponent(image.id)}/thumbnail`,
        imageUrl: `/api/media/stash/images/${encodeURIComponent(image.id)}/full`,
      })),
    };
  }

  async searchTags(query?: string): Promise<GalleryFilterOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const config = await this.getStashConfig();
    const tags = await this.stashAdapter.searchTags(normalizedQuery, config);
    return tags.map((tag) => ({ id: tag.id, name: tag.name }));
  }

  async searchStudios(query?: string): Promise<GalleryFilterOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const config = await this.getStashConfig();
    const studios = await this.stashAdapter.searchStudios(normalizedQuery, config);
    return studios.map((studio) => ({ id: studio.id, name: studio.name }));
  }

  private toGalleryFeedItemDto(
    gallery: StashLocalGalleryFeedItem,
  ): GalleryFeedItemDto {
    return {
      id: gallery.id,
      title: gallery.title,
      description: gallery.description,
      // Proxied through this app's own (HTTPS) backend rather than Stash's
      // raw URL directly -- Stash is commonly only reachable over plain
      // HTTP, which browsers block as mixed content on an HTTPS page.
      coverImageUrl: gallery.coverImageUrl
        ? `/api/media/stash/galleries/${encodeURIComponent(gallery.id)}/cover`
        : null,
      // NOT gallery.studioId: that's Stash's own local numeric primary key
      // (this whole feed is sourced directly from Stash), not the active
      // catalog provider's studio id space that /studio/:studioId expects --
      // see the identical note in library-scene-query.service.ts.
      studioId: null,
      studio: gallery.studio,
      studioImageUrl:
        gallery.studioId && gallery.studioImageUrl
          ? `/api/media/stash/studios/${encodeURIComponent(gallery.studioId)}/logo`
          : null,
      performers: gallery.performers.map((performer) => ({
        ...performer,
        imageUrl: performer.imageUrl
          ? `/api/media/stash/performers/${encodeURIComponent(performer.id)}/photo`
          : null,
      })),
      tagIds: gallery.tagIds,
      tagNames: gallery.tagNames,
      imageCount: gallery.imageCount,
      releaseDate: gallery.releaseDate,
      viewUrl: gallery.viewUrl,
      createdAt: gallery.createdAt ? gallery.createdAt.toISOString() : null,
      updatedAt: gallery.updatedAt ? gallery.updatedAt.toISOString() : null,
    };
  }

  private async getStashConfig(): Promise<StashAdapterBaseConfig> {
    const integration = await this.integrationsService.findOne(
      IntegrationType.STASH,
    );

    if (
      !integration.enabled ||
      integration.status !== IntegrationStatus.CONFIGURED
    ) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    return { baseUrl, apiKey: integration.apiKey };
  }

  private normalizeIds(ids: string[]): string[] {
    return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
  }
}
