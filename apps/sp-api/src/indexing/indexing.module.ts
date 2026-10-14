import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashModule } from '../providers/stash/stash.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { IndexingController } from './indexing.controller';
import { IndexingScheduler } from './indexing.scheduler';
import { IndexingService } from './indexing.service';
import { SyncStateService } from './sync-state.service';

@Module({
  imports: [IntegrationsModule, WhisparrModule, StashModule],
  controllers: [IndexingController],
  providers: [SyncStateService, IndexingService, IndexingScheduler],
  exports: [SyncStateService, IndexingService],
})
export class IndexingModule {}
