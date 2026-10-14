import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StudioFavoritesService } from './studio-favorites.service';

@Module({
  imports: [PrismaModule],
  providers: [StudioFavoritesService],
  exports: [StudioFavoritesService],
})
export class StudioFavoritesModule {}
