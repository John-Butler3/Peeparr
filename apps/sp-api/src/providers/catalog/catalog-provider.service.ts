import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../../integrations/integrations.service';
import { StashdbAdapter } from '../stashdb/stashdb.adapter';
import { TpdbAdapter } from '../tpdb/tpdb.adapter';
import type { StashdbAdapterBaseConfig } from '../stashdb/stashdb.adapter';
import type { CatalogAdapter } from './catalog-adapter.interface';
import {
  CatalogSnapshotService,
  type CatalogSnapshotKind,
} from './catalog-snapshot.service';
import {
  type CatalogProviderIntegrationType,
  type CatalogProviderKey,
  catalogProviderKeyFromIntegrationType,
  instanceCatalogProviderTypeFromIntegrations,
  isCatalogProviderReady,
  getCatalogProviderLabel,
} from './catalog-provider.util';

export interface ConfiguredCatalogProvider {
  integrationType: CatalogProviderIntegrationType;
  providerKey: CatalogProviderKey;
  label: string;
  baseUrl: string;
  apiKey: string | null;
}

/** Lookups whose results are kept, so they still answer while the provider is down. */
const SNAPSHOT_KINDS: Partial<
  Record<keyof CatalogAdapter, CatalogSnapshotKind>
> = {
  getSceneById: 'SCENE',
  getPerformerById: 'PERFORMER',
  getStudioById: 'STUDIO',
};

@Injectable()
export class CatalogProviderService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly tpdbAdapter: TpdbAdapter,
    @Optional() private readonly snapshots?: CatalogSnapshotService,
  ) {}

  /**
   * The active provider's adapter. Scene, performer and studio lookups go
   * through the stored copies: kept on every success, answering when the
   * provider is down.
   */
  async getConfiguredCatalogAdapter(): Promise<CatalogAdapter> {
    const provider = await this.getConfiguredCatalogProvider();
    const adapter = this.catalogAdapterFor(provider);
    return this.snapshots
      ? this.withSnapshots(adapter, provider.providerKey)
      : adapter;
  }

  /** The provider's own adapter, straight to it: no stored copies. */
  catalogAdapterFor(provider: ConfiguredCatalogProvider): CatalogAdapter {
    return provider.providerKey === 'TPDB'
      ? this.tpdbAdapter
      : this.stashdbAdapter;
  }

  private withSnapshots(
    adapter: CatalogAdapter,
    providerKey: string,
  ): CatalogAdapter {
    const snapshots = this.snapshots as CatalogSnapshotService;
    return new Proxy(adapter, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        const kind =
          typeof property === 'string'
            ? SNAPSHOT_KINDS[property as keyof CatalogAdapter]
            : undefined;
        if (!kind || typeof value !== 'function') {
          return value;
        }
        type Lookup = (
          id: string,
          config: StashdbAdapterBaseConfig,
        ) => Promise<unknown>;
        const lookup = (value as Lookup).bind(target) as Lookup;
        return (id: string, config: StashdbAdapterBaseConfig) =>
          snapshots.through(providerKey, kind, id, () => lookup(id, config));
      },
    });
  }

  async getInstanceCatalogProviderType(): Promise<CatalogProviderIntegrationType | null> {
    const integrations = await this.integrationsService.findAll();
    return instanceCatalogProviderTypeFromIntegrations(
      integrations.map((integration) => ({
        type: integration.type,
        enabled: integration.enabled,
        status: integration.status,
        baseUrl: integration.baseUrl,
        config: integration.config,
      })),
    );
  }

  async getConfiguredCatalogProviderType(): Promise<CatalogProviderIntegrationType | null> {
    const selectedType = await this.getInstanceCatalogProviderType();
    if (!selectedType) {
      return null;
    }

    try {
      const integration = await this.integrationsService.findOne(
        selectedType as IntegrationType,
      );

      return isCatalogProviderReady(integration) ? selectedType : null;
    } catch {
      return null;
    }
  }

  async getConfiguredCatalogProviderOrNull(): Promise<ConfiguredCatalogProvider | null> {
    const selectedType = await this.getConfiguredCatalogProviderType();
    if (!selectedType) {
      return null;
    }

    try {
      const integration = await this.integrationsService.findOne(
        selectedType as IntegrationType,
      );

      if (!isCatalogProviderReady(integration)) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      return {
        integrationType: selectedType,
        providerKey: catalogProviderKeyFromIntegrationType(selectedType),
        label: getCatalogProviderLabel(selectedType),
        baseUrl,
        apiKey: integration.apiKey,
      };
    } catch {
      return null;
    }
  }

  async getConfiguredCatalogProvider(): Promise<ConfiguredCatalogProvider> {
    const selectedType = await this.getInstanceCatalogProviderType();
    if (!selectedType) {
      throw new ConflictException(
        'No catalog provider has been chosen for this Peeparr instance.',
      );
    }

    const integration = await this.integrationsService.findOne(
      selectedType as IntegrationType,
    );
    const label = getCatalogProviderLabel(selectedType);
    const baseUrl = integration.baseUrl?.trim();

    if (
      !integration.enabled ||
      !integration.lastHealthyAt ||
      (integration.status !== IntegrationStatus.CONFIGURED &&
        integration.status !== IntegrationStatus.ERROR)
    ) {
      throw new ConflictException(
        `${label} catalog provider is not configured.`,
      );
    }

    if (!baseUrl) {
      throw new BadRequestException(
        `${label} catalog provider is missing a base URL.`,
      );
    }

    return {
      integrationType: selectedType,
      providerKey: catalogProviderKeyFromIntegrationType(selectedType),
      label,
      baseUrl,
      apiKey: integration.apiKey,
    };
  }
}
