import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_APP_VERSION = '0.0.0-dev';

@Controller('api/v1/status')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Public for health probes. The version is only shown when signed in, so
   * strangers can't tell which release (and its known issues) is running.
   */
  @Public()
  @Get()
  async getStatus(@Req() request: Request) {
    await this.prisma.$queryRaw`SELECT 1`;
    const { authenticated } =
      await this.authService.resolveRequestAuth(request);

    return {
      status: 'ok',
      database: 'ok',
      service: 'sp-api',
      ...(authenticated ? { version: resolveAppVersion() } : {}),
    };
  }
}

export function resolveAppVersion(): string {
  return (
    normalizeVersion(process.env.PEEPARR_VERSION) ??
    normalizeVersion(process.env.npm_package_version) ??
    DEFAULT_APP_VERSION
  );
}

function normalizeVersion(value: string | undefined): string | undefined {
  const version = value?.trim();
  return version ? version : undefined;
}
