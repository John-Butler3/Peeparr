import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LibraryModule } from '../library/library.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StashModule } from '../providers/stash/stash.module';
import {
  PerformerRecommendationsController,
  RecommendationsController,
} from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [PrismaModule, IntegrationsModule, StashModule, LibraryModule],
  controllers: [RecommendationsController, PerformerRecommendationsController],
  providers: [RecommendationsService],
})
export class RecommendationsModule {}
