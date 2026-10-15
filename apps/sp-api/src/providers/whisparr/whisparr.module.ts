import { Module } from '@nestjs/common';
import { RuntimeHealthModule } from '../../runtime-health/runtime-health.module';
import { WhisparrAdapter } from './whisparr.adapter';
import { WhisparrV2Client } from './whisparr-v2.client';

@Module({
  imports: [RuntimeHealthModule],
  providers: [WhisparrAdapter, WhisparrV2Client],
  exports: [WhisparrAdapter],
})
export class WhisparrModule {}
