import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TpdbModule } from '../providers/tpdb/tpdb.module';
import { WhisparrMetadataController } from './whisparr-metadata.controller';
import { WhisparrMetadataService } from './whisparr-metadata.service';

@Module({
  imports: [IntegrationsModule, TpdbModule],
  controllers: [WhisparrMetadataController],
  providers: [WhisparrMetadataService],
})
export class WhisparrMetadataModule {}
