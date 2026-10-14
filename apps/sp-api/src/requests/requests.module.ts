import { Module } from '@nestjs/common';
import { IndexingModule } from '../indexing/indexing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [IndexingModule, IntegrationsModule, WhisparrModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
