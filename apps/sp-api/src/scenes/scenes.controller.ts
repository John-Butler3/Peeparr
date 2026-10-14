import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SceneTagOptionDto } from './dto/scene-tag-option.dto';
import { SceneDetailsDto } from './dto/scene-details.dto';
import {
  ScenesFeedResponseDto,
  SimilarScenesResponseDto,
} from './dto/scenes-feed.dto';
import { ScenesQueryDto } from './dto/scenes-query.dto';
import { ScenesTagsQueryDto } from './dto/scenes-tags-query.dto';
import { SimilarScenesQueryDto } from './dto/similar-scenes-query.dto';
import { ToggleFavoriteDto } from './dto/toggle-favorite.dto';
import { ScenesService } from './scenes.service';

@Controller('api/scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get()
  getScenesFeed(
    @Query() query: ScenesQueryDto,
  ): Promise<ScenesFeedResponseDto> {
    return this.scenesService.getScenesFeed(
      query.page,
      query.perPage,
      query.sort,
      query.direction,
      query.tagIds,
      query.tagMode,
      query.favorites,
      query.studioIds,
      query.titleQuery,
    );
  }

  @Get('tags')
  getSceneTagOptions(
    @Query() query: ScenesTagsQueryDto,
  ): Promise<SceneTagOptionDto[]> {
    return this.scenesService.searchSceneTags(query.query);
  }

  // ThePornDB website's popular scenes (Home); empty without a website login.
  @Get('popular')
  getPopularScenes(): Promise<ScenesFeedResponseDto> {
    return this.scenesService.getPopularScenes();
  }

  @Post('studios/:studioId/favorite')
  favoriteStudio(
    @Param('studioId') studioId: string,
    @Body() body: ToggleFavoriteDto,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    return this.scenesService.favoriteStudio(studioId, body.favorite);
  }

  @Get(':stashId')
  getSceneById(@Param('stashId') stashId: string): Promise<SceneDetailsDto> {
    return this.scenesService.getSceneById(stashId);
  }

  @Get(':stashId/similar')
  getSimilarScenes(
    @Param('stashId') stashId: string,
    @Query() query: SimilarScenesQueryDto,
  ): Promise<SimilarScenesResponseDto> {
    return this.scenesService.getSimilarScenes(stashId, query.limit);
  }

  @Get(':stashId/stream')
  getSceneStreamUrl(
    @Param('stashId') stashId: string,
    @Query('copyId') copyId?: string,
  ): Promise<{
    streamUrl: string;
    stashSceneId: string;
    resumeSeconds: number;
    duration: number | null;
  }> {
    return this.scenesService.getSceneStreamUrl(stashId, copyId);
  }
}
