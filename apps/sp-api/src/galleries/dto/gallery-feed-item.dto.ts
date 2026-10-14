export interface GalleryPerformerDto {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface GalleryFeedItemDto {
  id: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  performers: GalleryPerformerDto[];
  tagIds: string[];
  tagNames: string[];
  imageCount: number;
  releaseDate: string | null;
  viewUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
}
