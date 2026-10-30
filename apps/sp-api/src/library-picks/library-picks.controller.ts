import {
  Controller,
  Get,
  ParseIntPipe,
  DefaultValuePipe,
  Query,
} from '@nestjs/common';
import { LibrarySceneFeedItemDto } from '../library/dto/library-scenes-feed.dto';
import { LibraryPicksService } from './library-picks.service';

@Controller('api/library')
export class LibraryPicksController {
  constructor(private readonly libraryPicksService: LibraryPicksService) {}

  // One scene from the whole library, at random (Home's shuffle button).
  @Get('random')
  async getRandomScene(
    @Query('exclude') exclude?: string,
  ): Promise<{ id: string | null }> {
    return {
      id: await this.libraryPicksService.getRandomSceneId(exclude?.trim()),
    };
  }

  // A random handful of library scenes not played yet (Up next).
  @Get('unplayed')
  async getRandomUnplayed(
    @Query('limit', new DefaultValuePipe(12), ParseIntPipe) limit: number,
    @Query('exclude') exclude?: string,
  ): Promise<{ items: LibrarySceneFeedItemDto[] }> {
    const excludeIds = (exclude ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^\d{1,12}$/.test(id))
      .slice(0, 50);
    return {
      items: await this.libraryPicksService.getRandomUnplayed(
        Math.min(Math.max(limit, 1), 30),
        excludeIds,
      ),
    };
  }
}
