import { WatchProgressResponseDto } from './dto/watch-progress.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateHomeRailDto, UpdateHomeRailDto } from './dto/create-home-rail.dto';
import { HomeRailContentDto } from './dto/home-rail-content.dto';
import { HomeRailDto } from './dto/home-rail.dto';
import { UpdateHomeRailsDto } from './dto/update-home-rails.dto';
import { HomeService } from './home.service';
import { SceneTagOptionDto } from '../scenes/dto/scene-tag-option.dto';
import { PerformerStudioOptionDto } from '../performers/dto/performer-studio-option.dto';

@Controller('api/home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('rails')
  getRails(): Promise<HomeRailDto[]> {
    return this.homeService.getRails();
  }

  @Get('continue-watching')
  getContinueWatching(): Promise<HomeRailContentDto> {
    return this.homeService.getContinueWatching();
  }

  @Get('watch-progress')
  getWatchProgress(): Promise<WatchProgressResponseDto> {
    return this.homeService.getWatchProgress();
  }

  @Get('recently-added')
  getRecentlyAdded(): Promise<HomeRailContentDto> {
    return this.homeService.getRecentlyAdded();
  }

  /** Clears a library scene's watch history in Stash. */
  @Post('watch-progress/:sceneId/unwatched')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markSceneUnwatched(@Param('sceneId') sceneId: string): Promise<void> {
    await this.homeService.markSceneUnwatched(sceneId);
  }

  @Post('continue-watching/:sceneId/reset')
  async resetContinueWatchingProgress(
    @Param('sceneId') sceneId: string,
  ): Promise<void> {
    await this.homeService.resetContinueWatchingProgress(sceneId);
  }

  @Get('stash/tags')
  searchStashTags(@Query('query') query?: string): Promise<SceneTagOptionDto[]> {
    return this.homeService.searchStashTags(query);
  }

  @Get('stash/studios')
  searchStashStudios(
    @Query('query') query?: string,
  ): Promise<PerformerStudioOptionDto[]> {
    return this.homeService.searchStashStudios(query);
  }

  @Get('rails/:id/items')
  getRailContent(@Param('id') id: string): Promise<HomeRailContentDto> {
    return this.homeService.getRailContent(id);
  }

  @Put('rails')
  updateRails(@Body() payload: UpdateHomeRailsDto): Promise<HomeRailDto[]> {
    return this.homeService.updateRails(payload);
  }

  @Post('rails')
  createRail(@Body() payload: CreateHomeRailDto): Promise<HomeRailDto> {
    return this.homeService.createRail(payload);
  }

  @Patch('rails/:id')
  updateRail(
    @Param('id') id: string,
    @Body() payload: UpdateHomeRailDto,
  ): Promise<HomeRailDto> {
    return this.homeService.updateRail(id, payload);
  }

  @Delete('rails/:id')
  async deleteRail(@Param('id') id: string): Promise<void> {
    await this.homeService.deleteRail(id);
  }
}
