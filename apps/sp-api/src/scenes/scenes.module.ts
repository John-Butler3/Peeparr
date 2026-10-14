import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PerformerFavoritesModule } from '../performers/performer-favorites.module';
import { PerformerImagePreferenceModule } from '../performers/performer-image-preference.module';
import { StashModule } from '../providers/stash/stash.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { SettingsModule } from '../settings/settings.module';
import { StudioFavoritesModule } from '../studios/studio-favorites.module';
import { TpdbWebModule } from '../tpdb-web/tpdb-web.module';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';

@Module({
  imports: [
    IntegrationsModule,
    StashdbModule,
    SceneStatusModule,
    StashModule,
    WhisparrModule,
    SettingsModule,
    PerformerFavoritesModule,
    PerformerImagePreferenceModule,
    TpdbWebModule,
    StudioFavoritesModule,
  ],
  controllers: [ScenesController],
  providers: [ScenesService],
})
export class ScenesModule {}
