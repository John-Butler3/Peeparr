import { Controller, Get, Param, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
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
