import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { SettingsModule } from '../settings/settings.module';
import { UpcomingController } from './upcoming.controller';
import { UpcomingService } from './upcoming.service';

@Module({
  imports: [IntegrationsModule, SceneStatusModule, SettingsModule],
  controllers: [UpcomingController],
  providers: [UpcomingService],
})
export class UpcomingModule {}
