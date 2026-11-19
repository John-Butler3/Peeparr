import { Module } from '@nestjs/common';
import { StashModule } from '../providers/stash/stash.module';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { CatalogSnapshotBackfillService } from '../providers/catalog/catalog-snapshot-backfill.service';
import { CatalogSnapshotService } from '../providers/catalog/catalog-snapshot.service';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { TpdbModule } from '../providers/tpdb/tpdb.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { RuntimeHealthModule } from '../runtime-health/runtime-health.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { RuntimeHealthRefreshController } from './runtime-health-refresh.controller';

@Module({
  imports: [
    StashModule,
    StashdbModule,
    TpdbModule,
    WhisparrModule,
    RuntimeHealthModule,
  ],
  controllers: [IntegrationsController, RuntimeHealthRefreshController],
  providers: [
    IntegrationsService,
    CatalogProviderService,
    CatalogSnapshotService,
    CatalogSnapshotBackfillService,
  ],
  exports: [IntegrationsService, CatalogProviderService],
})
export class IntegrationsModule {}
