import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TpdbWebModule } from '../tpdb-web/tpdb-web.module';
import { StudioFavoritesModule } from './studio-favorites.module';
import { StudiosController } from './studios.controller';
import { StudiosService } from './studios.service';

@Module({
  imports: [IntegrationsModule, StudioFavoritesModule, TpdbWebModule],
  controllers: [StudiosController],
  providers: [StudiosService],
})
export class StudiosModule {}
