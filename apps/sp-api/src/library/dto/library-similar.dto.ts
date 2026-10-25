import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** A scene's tags (by name), to find library scenes that share them. */
export class LibrarySimilarByTagsDto {
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  tagNames!: string[];

  /** Library scenes to leave out (the scene itself, and any shown already). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  excludeIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(40)
  limit?: number;
}
