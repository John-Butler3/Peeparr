import { Controller, Get, Param, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { LibrarySceneFeedItemDto } from '../library/dto/library-scenes-feed.dto';
import { RecommendationsService } from './recommendations.service';

class RecommendedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit?: number;
}

@Controller('api/library/scenes')
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get(':sceneId/recommended')
  getRecommended(
    @Param('sceneId') sceneId: string,
    @Query() query: RecommendedQueryDto,
  ): Promise<{ items: LibrarySceneFeedItemDto[] }> {
    return this.recommendationsService.getRecommended(sceneId, query.limit);
  }
}

class PerformersRecommendedQueryDto extends RecommendedQueryDto {
  // Catalog performer ids, comma-separated (or repeated).
  @IsOptional()
  @Transform(({ value }) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((entry: unknown) => String(entry ?? '').split(','))
      .map((id: string) => id.trim())
      .filter((id: string) => id.length > 0),
  )
  @IsArray()
  @IsString({ each: true })
  performers?: string[];
}

// Up next for a scene that isn't in the library: library scenes with its
// (female) performers, given as catalog ids.
@Controller('api/library')
export class PerformerRecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get('recommended')
  getRecommendedForPerformers(
    @Query() query: PerformersRecommendedQueryDto,
  ): Promise<{ items: LibrarySceneFeedItemDto[] }> {
    return this.recommendationsService.getRecommendedForPerformers(
      query.performers ?? [],
      query.limit,
    );
  }
}
