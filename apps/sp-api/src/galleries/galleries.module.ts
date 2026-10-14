import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashModule } from '../providers/stash/stash.module';
import { GalleriesController } from './galleries.controller';
import { GalleriesService } from './galleries.service';

@Module({
  imports: [IntegrationsModule, StashModule],
  controllers: [GalleriesController],
  providers: [GalleriesService],
})
export class GalleriesModule {}
