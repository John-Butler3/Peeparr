import { Module } from '@nestjs/common';
import { PerformerImagePreferenceService } from './performer-image-preference.service';

@Module({
  providers: [PerformerImagePreferenceService],
  exports: [PerformerImagePreferenceService],
})
export class PerformerImagePreferenceModule {}
