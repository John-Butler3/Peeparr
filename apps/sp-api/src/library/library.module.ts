import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LibraryController } from './library.controller';
import { LibrarySceneQueryService } from './library-scene-query.service';
import { LibrarySearchService } from './library-search.service';
import { LibraryService } from './library.service';

@Module({
  imports: [PrismaModule],
  controllers: [LibraryController],
  providers: [LibraryService, LibrarySceneQueryService, LibrarySearchService],
  exports: [LibraryService, LibrarySceneQueryService],
})
export class LibraryModule {}
