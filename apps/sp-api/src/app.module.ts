import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AcquisitionModule } from './acquisition/acquisition.module';
import { AuthModule } from './auth/auth.module';
import { GalleriesModule } from './galleries/galleries.module';
import { GroupsModule } from './groups/groups.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { HealthModule } from './health/health.module';
import { HomeModule } from './home/home.module';
import { IndexingModule } from './indexing/indexing.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { LibraryModule } from './library/library.module';
import { LibraryDeletionModule } from './library-deletion/library-deletion.module';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { PerformerMonitoringModule } from './performers/performer-monitoring.module';
import { PerformersModule } from './performers/performers.module';
import { RequestsModule } from './requests/requests.module';
import { RuntimeHealthModule } from './runtime-health/runtime-health.module';
import { ScenesModule } from './scenes/scenes.module';
import { SettingsModule } from './settings/settings.module';
import { SetupModule } from './setup/setup.module';
import { StudiosModule } from './studios/studios.module';
import { UpcomingModule } from './upcoming/upcoming.module';
import { WhisparrMetadataModule } from './whisparr-metadata/whisparr-metadata.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    HealthModule,
    RuntimeHealthModule,
    HomeModule,
    MediaModule,
    LibraryModule,
    LibraryDeletionModule,
    GalleriesModule,
    GroupsModule,
    RecommendationsModule,
    IndexingModule,
    IntegrationsModule,
    SettingsModule,
    SetupModule,
    AcquisitionModule,
    ScenesModule,
    RequestsModule,
    PerformersModule,
    PerformerMonitoringModule,
    StudiosModule,
    UpcomingModule,
    WhisparrMetadataModule,
  ],
})
export class AppModule {}
