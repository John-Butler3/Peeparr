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
