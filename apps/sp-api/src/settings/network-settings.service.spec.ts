import { BadRequestException, ConflictException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { applyTrustProxy, currentTrustProxy } from '../security/http-security';
import { NetworkSettingsService } from './network-settings.service';

describe('NetworkSettingsService', () => {
  let saved: string | null;
  let prisma: { appSettings: { findUnique: jest.Mock; upsert: jest.Mock } };
  let expressApp: { set: jest.Mock };
  let service: NetworkSettingsService;
  const request = (headers: Record<string, string> = {}) => ({ headers }) as unknown as Request;

  beforeEach(() => {
    saved = null;
    prisma = {
      appSettings: {
        findUnique: jest.fn(async () => ({ trustProxy: saved })),
        upsert: jest.fn(async ({ update }: { update: { trustProxy: string | null } }) => {
          saved = update.trustProxy;
        }),
      },
    };
    expressApp = { set: jest.fn() };
    service = new NetworkSettingsService(
      prisma as unknown as PrismaService,
      { httpAdapter: { getInstance: () => expressApp } } as unknown as HttpAdapterHost,
    );
  });

  afterEach(() => {
    delete process.env.PEEPARR_TRUST_PROXY;
    applyTrustProxy({ set: jest.fn() }, false);
  });

  it('saves a proxy choice and applies it straight away', async () => {
    const result = await service.update('1', request());

    expect(saved).toBe('1');
    expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 1);
    expect(currentTrustProxy()).toBe(1);
    expect(result).toMatchObject({ trustProxy: '1', effectiveTrustProxy: '1', lockedByEnvironment: false });

    await service.update('10.0.0.2', request());
    expect(expressApp.set).toHaveBeenLastCalledWith('trust proxy', '10.0.0.2');

    await service.update(null, request());
    expect(saved).toBeNull();
    expect(currentTrustProxy()).toBe(false);
  });

  it('refuses values that would trust the wrong senders', async () => {
    await expect(service.update('true', request())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('proxy.local', request())).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.appSettings.upsert).not.toHaveBeenCalled();
  });

  it('leaves it to PEEPARR_TRUST_PROXY when that is set', async () => {
    process.env.PEEPARR_TRUST_PROXY = '1';
    await expect(service.update('2', request())).rejects.toBeInstanceOf(ConflictException);
    expect((await service.get(request())).lockedByEnvironment).toBe(true);

    saved = '2';
    await service.onApplicationBootstrap();
    expect(expressApp.set).not.toHaveBeenCalled();
  });

  it('applies the saved choice when the app starts', async () => {
    saved = '172.16.0.0/12';
    await service.onApplicationBootstrap();
    expect(expressApp.set).toHaveBeenCalledWith('trust proxy', '172.16.0.0/12');
  });

  it('notices when you are connected through a proxy', async () => {
    expect((await service.get(request())).connectedThroughProxy).toBe(false);
    expect((await service.get(request({ 'x-forwarded-for': '203.0.113.9' }))).connectedThroughProxy).toBe(true);
  });
});
