import { GalleryFeedItemDto } from './gallery-feed-item.dto';

export interface GalleriesFeedResponseDto {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: GalleryFeedItemDto[];
}
