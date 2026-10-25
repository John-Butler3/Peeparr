import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StashModule } from '../providers/stash/stash.module';
import { LibraryPicksController } from './library-picks.controller';
import { LibraryPicksService } from './library-picks.service';

@Module({
  imports: [PrismaModule, StashModule, LibraryModule],
  controllers: [LibraryPicksController],
  providers: [LibraryPicksService],
})
export class LibraryPicksModule {}
