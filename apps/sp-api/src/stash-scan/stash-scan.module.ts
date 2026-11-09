import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashModule } from '../providers/stash/stash.module';
import { StashScanController } from './stash-scan.controller';
import { StashScanService } from './stash-scan.service';

@Module({
  imports: [IntegrationsModule, StashModule],
  controllers: [StashScanController],
  providers: [StashScanService],
})
export class StashScanModule {}
