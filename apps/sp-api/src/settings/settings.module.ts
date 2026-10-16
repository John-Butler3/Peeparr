import { Module } from '@nestjs/common';
import { AppSettingsController } from './app-settings.controller';
import { AppSettingsService } from './app-settings.service';
import { NetworkSettingsController } from './network-settings.controller';
import { NetworkSettingsService } from './network-settings.service';

@Module({
  controllers: [AppSettingsController, NetworkSettingsController],
  providers: [AppSettingsService, NetworkSettingsService],
  exports: [AppSettingsService],
})
export class SettingsModule {}
