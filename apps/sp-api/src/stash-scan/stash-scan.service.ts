import { Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  StashAdapter,
  StashAdapterBaseConfig,
  StashScanTarget,
} from '../providers/stash/stash.adapter';
import { StashScanStartedDto } from './dto/start-stash-scan.dto';

/**
 * Starts scans in Stash on request: of the video library, or of the image
 * folders that galleries come from. Stash does the scanning; this only
 * queues it and reports the job.
 */
@Injectable()
export class StashScanService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashAdapter: StashAdapter,
  ) {}

  async start(target: StashScanTarget): Promise<StashScanStartedDto> {
    const config = await this.getStashConfig();
    const job = await this.stashAdapter.startScan(target, config);
    return { target, jobId: job.jobId, paths: job.paths };
  }

  private async getStashConfig(): Promise<StashAdapterBaseConfig> {
    const integration = await this.integrationsService.findOne(
      IntegrationType.STASH,
    );

    if (
      !integration.enabled ||
      integration.status !== IntegrationStatus.CONFIGURED
    ) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    return { baseUrl, apiKey: integration.apiKey };
  }
}
