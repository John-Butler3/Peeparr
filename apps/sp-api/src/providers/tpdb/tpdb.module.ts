import { Module } from '@nestjs/common';
import { RuntimeHealthModule } from '../../runtime-health/runtime-health.module';
import { TpdbAdapter } from './tpdb.adapter';

@Module({
  imports: [RuntimeHealthModule],
  providers: [TpdbAdapter],
  exports: [TpdbAdapter],
})
export class TpdbModule {}
