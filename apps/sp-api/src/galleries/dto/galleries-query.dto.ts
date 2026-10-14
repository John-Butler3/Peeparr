import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { DiscoverQueryDto } from '../../discover/dto/discover-query.dto';

function parseStringArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  const segments = Array.isArray(value) ? value : [value];
  return segments
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [String(entry)]))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export class GalleriesQueryDto extends DiscoverQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  query?: string;

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @IsString({ each: true })
  studioIds?: string[];
}
