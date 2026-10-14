import { Module } from '@nestjs/common';
import { PerformerFavoritesService } from './performer-favorites.service';

@Module({
  providers: [PerformerFavoritesService],
  exports: [PerformerFavoritesService],
})
export class PerformerFavoritesModule {}
