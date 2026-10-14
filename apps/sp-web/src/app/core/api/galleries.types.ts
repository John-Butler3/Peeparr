export interface GalleryPerformer {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface GalleryFeedItem {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  performers: GalleryPerformer[];
  tagIds: string[];
  tagNames: string[];
  imageCount: number;
  releaseDate: string | null;
  viewUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GalleriesFeedResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: GalleryFeedItem[];
}

export interface GalleryImage {
  id: string;
  title: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface GalleryImagesFeed {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: GalleryImage[];
}

export interface GalleryFilterOption {
  id: string;
  name: string;
}
