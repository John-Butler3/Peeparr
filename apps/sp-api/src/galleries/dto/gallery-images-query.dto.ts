import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Image grids are naturally paged larger than scene/performer lists --
// individual images are far lighter than scene cards -- so this doesn't
// reuse DiscoverQueryDto's perPage cap of 50.
export class GalleryImagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
