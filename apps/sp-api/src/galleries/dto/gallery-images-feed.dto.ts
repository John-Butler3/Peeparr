export interface GalleryImageDto {
  id: string;
  title: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface GalleryImagesFeedDto {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: GalleryImageDto[];
}
