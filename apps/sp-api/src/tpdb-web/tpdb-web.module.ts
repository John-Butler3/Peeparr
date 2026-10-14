import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TpdbModule } from '../providers/tpdb/tpdb.module';
import { TpdbWebController } from './tpdb-web.controller';
import { TpdbWebService } from './tpdb-web.service';

@Module({
  imports: [PrismaModule, TpdbModule],
  controllers: [TpdbWebController],
  providers: [TpdbWebService],
  exports: [TpdbWebService],
})
export class TpdbWebModule {}
