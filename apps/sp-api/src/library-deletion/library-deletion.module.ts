import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StashModule } from '../providers/stash/stash.module';
import { RequestsModule } from '../requests/requests.module';
import { LibraryDeletionController } from './library-deletion.controller';
import { LibraryDeletionService } from './library-deletion.service';

@Module({
  imports: [PrismaModule, StashModule, RequestsModule],
  controllers: [LibraryDeletionController],
  providers: [LibraryDeletionService],
})
export class LibraryDeletionModule {}
