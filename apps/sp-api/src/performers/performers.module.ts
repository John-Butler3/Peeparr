import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashModule } from '../providers/stash/stash.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { SettingsModule } from '../settings/settings.module';
import { TpdbWebModule } from '../tpdb-web/tpdb-web.module';
import { PerformerFavoritesModule } from './performer-favorites.module';
import { PerformerImagePreferenceModule } from './performer-image-preference.module';
import { PerformersController } from './performers.controller';
import { PerformersService } from './performers.service';

@Module({
  imports: [
    IntegrationsModule,
    StashModule,
    StashdbModule,
    SceneStatusModule,
    SettingsModule,
    PerformerFavoritesModule,
    PerformerImagePreferenceModule,
    TpdbWebModule,
  ],
  controllers: [PerformersController],
  providers: [PerformersService],
})
export class PerformersModule {}
