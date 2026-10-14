import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LibraryModule } from '../library/library.module';
import { StashModule } from '../providers/stash/stash.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { StashGroupsClient } from './stash-groups.client';

@Module({
  imports: [IntegrationsModule, StashModule, LibraryModule],
  controllers: [GroupsController],
  providers: [GroupsService, StashGroupsClient],
})
export class GroupsModule {}
