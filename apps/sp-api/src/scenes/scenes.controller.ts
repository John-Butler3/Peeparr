import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { StreamTokenService } from '../auth/stream-token.service';
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
  constructor(
    private readonly scenesService: ScenesService,
    private readonly authService: AuthService,
    private readonly streamTokens: StreamTokenService,
  ) {}

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

  // The URL carries a stream token so AirPlay receivers can fetch it too.
  @Get(':stashId/stream')
  async getSceneStreamUrl(
    @Param('stashId') stashId: string,
    @Req() request: Request,
    @Query('copyId') copyId?: string,
  ): Promise<{
    streamUrl: string;
    stashSceneId: string;
    resumeSeconds: number;
    duration: number | null;
  }> {
    const [source, auth] = await Promise.all([
      this.scenesService.getSceneStreamUrl(stashId, copyId),
      this.authService.resolveRequestAuth(request),
    ]);
    if (!auth.user) {
      return source;
    }
    const token = this.streamTokens.issue(source.stashSceneId, auth.user);
    return {
      ...source,
      streamUrl: `${source.streamUrl}?st=${encodeURIComponent(token)}`,
    };
  }
}
