import { BadRequestException, ConflictException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../../integrations/integrations.service';
import { StashdbAdapter } from '../stashdb/stashdb.adapter';
import { TpdbAdapter } from '../tpdb/tpdb.adapter';
import { buildCatalogProviderSelectionConfig } from './catalog-provider.util';
import { CatalogProviderService } from './catalog-provider.service';

describe('CatalogProviderService', () => {
  const integrationsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  const stashdbAdapter = {} as unknown as StashdbAdapter;
  const tpdbAdapter = {} as unknown as TpdbAdapter;

  let service: CatalogProviderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CatalogProviderService(
      integrationsService,
      stashdbAdapter,
      tpdbAdapter,
    );
  });

  it('keeps instance catalog identity when the chosen provider is in ERROR', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.FANSDB,
        enabled: true,
        status: IntegrationStatus.ERROR,
        baseUrl: 'http://fansdb.local/graphql',
        config: buildCatalogProviderSelectionConfig(),
      },
      {
        type: IntegrationType.STASHDB,
        enabled: true,
        status: IntegrationStatus.NOT_CONFIGURED,
        baseUrl: null,
        config: null,
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.FANSDB,
      enabled: true,
      status: IntegrationStatus.ERROR,
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
    });

    await expect(service.getInstanceCatalogProviderType()).resolves.toBe(
      'FANSDB',
    );
    await expect(
      service.getConfiguredCatalogProviderType(),
    ).resolves.toBeNull();
  });

  it('resolves STASHDB as the configured catalog provider', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://stashdb.local/graphql',
        config: buildCatalogProviderSelectionConfig(),
        lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
      },
      {
        type: IntegrationType.FANSDB,
        enabled: true,
        status: IntegrationStatus.NOT_CONFIGURED,
        baseUrl: null,
        config: null,
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.STASHDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-key',
      lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(service.getConfiguredCatalogProvider()).resolves.toEqual({
      integrationType: 'STASHDB',
      providerKey: 'STASHDB',
      label: 'StashDB',
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-key',
    });
  });

  it('keeps using the enabled configured provider in a legacy dual-config state', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: false,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://stashdb.local/graphql',
        lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
      },
      {
        type: IntegrationType.FANSDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://fansdb.local/graphql',
        lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.FANSDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
      lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(service.getConfiguredCatalogProvider()).resolves.toEqual({
      integrationType: 'FANSDB',
      providerKey: 'FANSDB',
      label: 'FansDB',
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
    });
  });

  it('throws when the configured catalog provider is missing a base URL', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.FANSDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://fansdb.local/graphql',
        config: buildCatalogProviderSelectionConfig(),
        lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.FANSDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: '   ',
      apiKey: null,
      lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(service.getConfiguredCatalogProvider()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when no catalog provider is configured', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: true,
        status: IntegrationStatus.NOT_CONFIGURED,
        baseUrl: null,
        config: null,
      },
      {
        type: IntegrationType.FANSDB,
        enabled: true,
        status: IntegrationStatus.NOT_CONFIGURED,
        baseUrl: null,
        config: null,
      },
    ]);

    await expect(service.getConfiguredCatalogProvider()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws when a chosen catalog provider has never tested healthy', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://stashdb.local/graphql',
        config: buildCatalogProviderSelectionConfig(),
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.STASHDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-key',
      lastHealthyAt: null,
    });

    await expect(service.getConfiguredCatalogProvider()).rejects.toThrow(
      'StashDB catalog provider is not configured.',
    );
  });

  it('throws when a chosen catalog provider is unhealthy', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: true,
        status: IntegrationStatus.ERROR,
        baseUrl: 'http://stashdb.local/graphql',
        config: buildCatalogProviderSelectionConfig(),
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.STASHDB,
      enabled: true,
      status: IntegrationStatus.ERROR,
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-key',
    });

    await expect(service.getConfiguredCatalogProvider()).rejects.toThrow(
      'StashDB catalog provider is not configured.',
    );
  });

  it('dispatches to the StashdbAdapter when StashDB is the active provider', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://stashdb.local/graphql',
        config: buildCatalogProviderSelectionConfig(),
        lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.STASHDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-key',
      lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(service.getConfiguredCatalogAdapter()).resolves.toBe(
      stashdbAdapter,
    );
  });

  it('dispatches to the TpdbAdapter when TPDB is the active provider', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.TPDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'https://api.theporndb.net',
        config: buildCatalogProviderSelectionConfig(),
        lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.TPDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'https://api.theporndb.net',
      apiKey: 'tpdb-token',
      lastHealthyAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    await expect(service.getConfiguredCatalogAdapter()).resolves.toBe(
      tpdbAdapter,
    );
  });
});
