import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RequestsModule } from '../requests/requests.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { SettingsModule } from '../settings/settings.module';
import { PerformerMonitoringController } from './performer-monitoring.controller';
import { PerformerMonitoringService } from './performer-monitoring.service';

@Module({
  imports: [
    IntegrationsModule,
    RequestsModule,
    SceneStatusModule,
    SettingsModule,
  ],
  controllers: [PerformerMonitoringController],
  providers: [PerformerMonitoringService],
})
export class PerformerMonitoringModule {}
