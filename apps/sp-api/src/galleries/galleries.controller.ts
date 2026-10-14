import { Controller, Get, Param, Query } from '@nestjs/common';
import { GalleriesQueryDto } from './dto/galleries-query.dto';
import { GalleriesFeedResponseDto } from './dto/galleries-feed-response.dto';
import { GalleryFeedItemDto } from './dto/gallery-feed-item.dto';
import { GalleryFilterOptionDto } from './dto/gallery-filter-option.dto';
import { GalleryImagesFeedDto } from './dto/gallery-images-feed.dto';
import { GalleryImagesQueryDto } from './dto/gallery-images-query.dto';
import { GalleriesService } from './galleries.service';

@Controller('api/galleries')
export class GalleriesController {
  constructor(private readonly galleriesService: GalleriesService) {}

  @Get()
  getGalleriesFeed(
    @Query() query: GalleriesQueryDto,
  ): Promise<GalleriesFeedResponseDto> {
    return this.galleriesService.getGalleriesFeed(query.page, query.perPage, {
      query: query.query,
      tagIds: query.tagIds,
      studioIds: query.studioIds,
    });
  }

  @Get('tags')
  getGalleryTags(@Query('query') query?: string): Promise<GalleryFilterOptionDto[]> {
    return this.galleriesService.searchTags(query);
  }

  @Get('studios')
  getGalleryStudios(@Query('query') query?: string): Promise<GalleryFilterOptionDto[]> {
    return this.galleriesService.searchStudios(query);
  }

  @Get(':galleryId')
  getGalleryById(
    @Param('galleryId') galleryId: string,
  ): Promise<GalleryFeedItemDto> {
    return this.galleriesService.getGalleryById(galleryId);
  }

  @Get(':galleryId/images')
  getGalleryImages(
    @Param('galleryId') galleryId: string,
    @Query() query: GalleryImagesQueryDto,
  ): Promise<GalleryImagesFeedDto> {
    return this.galleriesService.getGalleryImages(
      galleryId,
      query.page,
      query.perPage,
    );
  }
}
