import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { LibrarySceneFeedItemDto } from './library-scenes-feed.dto';

export class LibrarySearchQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  perPage?: number;
}

export class LibrarySearchScenesDto {
  total!: number;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  items!: LibrarySceneFeedItemDto[];
}

export interface LibrarySearchPerformerDto {
  /** Stash-local performer id (usable as a library performerIds filter). */
  id: string;
  name: string;
  imageUrl: string;
  sceneCount: number;
}

export interface LibrarySearchStudioDto {
  /** Stash-local studio id (usable as a library studioIds filter). */
  id: string;
  name: string;
  imageUrl: string | null;
  sceneCount: number;
}

export interface LibrarySearchTagDto {
  id: string;
  name: string;
  sceneCount: number;
}

export class LibrarySearchDto {
  query!: string;
  scenes!: LibrarySearchScenesDto;
  performers!: LibrarySearchPerformerDto[];
  studios!: LibrarySearchStudioDto[];
  tags!: LibrarySearchTagDto[];
}
