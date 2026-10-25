import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { LibrarySimilarByTagsDto } from './dto/library-similar.dto';
import { LibrarySearchService } from './library-search.service';
import { LibraryService } from './library.service';
import { LibraryOptionsQueryDto } from './dto/library-options-query.dto';
import {
  LibrarySceneDetailDto,
  LibrarySceneFeedItemDto,
  LibraryScenesFeedDto,
} from './dto/library-scenes-feed.dto';
import { LibraryScenesQueryDto } from './dto/library-scenes-query.dto';
import {
  LibrarySearchDto,
  LibrarySearchQueryDto,
  LibrarySearchScenesDto,
} from './dto/library-search.dto';
import { LibraryStudioOptionDto } from './dto/library-studio-option.dto';
import { LibraryTagOptionDto } from './dto/library-tag-option.dto';

@Controller('api/library')
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly librarySearchService: LibrarySearchService,
  ) {}

  @Get('scenes')
  getLibraryScenes(
    @Query() query: LibraryScenesQueryDto,
  ): Promise<LibraryScenesFeedDto> {
    return this.libraryService.getScenesFeed(
      query.page,
      query.perPage,
      query.sort,
      query.direction,
      query.query,
      query.tagIds,
      query.tagMode,
      query.studioIds,
      query.favoritePerformersOnly,
      query.favoriteStudiosOnly,
      query.favoriteTagsOnly,
      query.performerIds,
    );
  }

  // Similar scenes: library scenes sharing a scene's tags, rarest first.
  @Post('similar')
  @HttpCode(200)
  async getSimilarByTags(
    @Body() body: LibrarySimilarByTagsDto,
  ): Promise<{ items: LibrarySceneFeedItemDto[] }> {
    return {
      items: await this.libraryService.getSimilarByTags(
        body.tagNames,
        body.excludeIds,
        body.limit,
      ),
    };
  }

  @Get('scenes/:sceneId')
  getLibraryScene(
    @Param('sceneId') sceneId: string,
  ): Promise<LibrarySceneDetailDto> {
    return this.libraryService.getSceneDetail(sceneId);
  }

  @Get('tags')
  getLibraryTags(
    @Query() query: LibraryOptionsQueryDto,
  ): Promise<LibraryTagOptionDto[]> {
    return this.libraryService.searchTags(query.query);
  }

  @Get('studios')
  getLibraryStudios(
    @Query() query: LibraryOptionsQueryDto,
  ): Promise<LibraryStudioOptionDto[]> {
    return this.libraryService.searchStudios(query.query);
  }

  @Get('search')
  searchLibrary(
    @Query() query: LibrarySearchQueryDto,
  ): Promise<LibrarySearchDto> {
    return this.librarySearchService.search(query.query, query.perPage);
  }

  @Get('search/scenes')
  searchLibraryScenes(
    @Query() query: LibrarySearchQueryDto,
  ): Promise<LibrarySearchScenesDto> {
    return this.librarySearchService.searchScenes(
      query.query,
      query.page,
      query.perPage,
    );
  }
}
