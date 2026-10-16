import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyTrustProxy,
  currentTrustProxy,
  parseTrustProxy,
  trustProxyProblem,
} from '../security/http-security';

export interface NetworkSettingsDto {
  /** The saved Remote access choice: null (none), a hop count, or proxy addresses. */
  trustProxy: string | null;
  /** What's in effect now (the environment wins over the saved choice). */
  effectiveTrustProxy: string | null;
  /** Set by PEEPARR_TRUST_PROXY on the server, so it can't be changed here. */
  lockedByEnvironment: boolean;
  /** This very request came through a proxy (it carried forwarding headers). */
  connectedThroughProxy: boolean;
}

const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip'];

/**
 * Remote access: which reverse proxy Peeparr trusts, chosen in setup or
 * Settings and applied straight away (no restart). PEEPARR_TRUST_PROXY,
 * when set, overrides it.
 */
@Injectable()
export class NetworkSettingsService implements OnApplicationBootstrap {
  private static readonly SINGLETON_KEY = 1;
  private readonly logger = new Logger(NetworkSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.lockedByEnvironment()) {
      return;
    }
    try {
      const saved = await this.saved();
      if (saved) {
        this.apply(saved);
        this.logger.log(`Trusting the reverse proxy (Remote access setting): ${saved}`);
      }
    } catch (error) {
      this.logger.warn(`Couldn't load the Remote access setting: ${(error as Error)?.message}`);
    }
  }

  async get(request: Request): Promise<NetworkSettingsDto> {
    const effective = currentTrustProxy();
    return {
      trustProxy: await this.saved(),
      effectiveTrustProxy: effective === false ? null : String(effective),
      lockedByEnvironment: this.lockedByEnvironment(),
      connectedThroughProxy: FORWARDING_HEADERS.some((header) => request.headers[header] !== undefined),
    };
  }

  async update(value: string | null, request: Request): Promise<NetworkSettingsDto> {
    if (this.lockedByEnvironment()) {
      throw new ConflictException('Remote access is set by PEEPARR_TRUST_PROXY on the server.');
    }
    const trimmed = value?.trim() || null;
    const problem = trimmed ? trustProxyProblem(trimmed) : null;
    if (problem) {
      throw new BadRequestException(problem);
    }

    await this.prisma.appSettings.upsert({
      where: { singletonKey: NetworkSettingsService.SINGLETON_KEY },
      create: { singletonKey: NetworkSettingsService.SINGLETON_KEY, trustProxy: trimmed },
      update: { trustProxy: trimmed },
    });
    this.apply(trimmed);
    return this.get(request);
  }

  private apply(value: string | null): void {
    applyTrustProxy(this.adapterHost.httpAdapter.getInstance(), parseTrustProxy(value));
  }

  private async saved(): Promise<string | null> {
    const settings = await this.prisma.appSettings.findUnique({
      where: { singletonKey: NetworkSettingsService.SINGLETON_KEY },
      select: { trustProxy: true },
    });
    return settings?.trustProxy ?? null;
  }

  private lockedByEnvironment(): boolean {
    return Boolean(process.env.PEEPARR_TRUST_PROXY?.trim());
  }
}
