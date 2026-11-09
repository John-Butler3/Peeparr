import { NotFoundException } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashScanService } from './stash-scan.service';

describe('StashScanService', () => {
  const findOne = jest.fn();
  const startScan = jest.fn();
  const service = new StashScanService(
    { findOne } as unknown as IntegrationsService,
    { startScan } as unknown as StashAdapter,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockResolvedValue({
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: ' http://stash.local ',
      apiKey: 'stash-key',
    });
    startScan.mockResolvedValue({ jobId: '77', paths: ['/media/images'] });
  });

  it('starts a scan of the requested kind in the configured Stash', async () => {
    await expect(service.start('galleries')).resolves.toEqual({
      target: 'galleries',
      jobId: '77',
      paths: ['/media/images'],
    });
    expect(startScan).toHaveBeenCalledWith('galleries', {
      baseUrl: 'http://stash.local',
      apiKey: 'stash-key',
    });
  });

  it('refuses when Stash is not configured, without asking Stash', async () => {
    findOne.mockResolvedValue({
      enabled: true,
      status: IntegrationStatus.NOT_CONFIGURED,
      baseUrl: 'http://stash.local',
      apiKey: null,
    });
    await expect(service.start('library')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(startScan).not.toHaveBeenCalled();
  });
});
