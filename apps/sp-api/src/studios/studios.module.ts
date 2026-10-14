import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StudiosController } from './studios.controller';
import { StudiosService } from './studios.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [StudiosController],
  providers: [StudiosService],
})
export class StudiosModule {}
