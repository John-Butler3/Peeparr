import { Controller, Get, Param, Query } from '@nestjs/common';
import { LibrarySearchService } from './library-search.service';
import { LibraryService } from './library.service';
import { LibraryOptionsQueryDto } from './dto/library-options-query.dto';
import {
  LibrarySceneDetailDto,
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
