import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrivateNetworkGuard } from './private-network.guard';

const from = (remoteAddress: string | undefined, headers: Record<string, string> = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ socket: { remoteAddress }, headers }) }),
  }) as unknown as ExecutionContext;

describe('PrivateNetworkGuard', () => {
  const guard = new PrivateNetworkGuard();

  afterEach(() => {
    delete process.env.PEEPARR_METADATA_ALLOW_ANY_NETWORK;
  });

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.18.0.4',
    '192.168.1.20',
    '100.101.102.103',
    '::1',
    '::ffff:192.168.1.20',
    'fd12:3456::1',
    'fe80::1',
  ])('lets %s through', (address) => {
    expect(guard.canActivate(from(address))).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '::ffff:1.2.3.4', '2001:4860:4860::8888', undefined])(
    'refuses %s',
    (address) => {
      expect(() => guard.canActivate(from(address))).toThrow(ForbiddenException);
    },
  );

  it('ignores a forged X-Forwarded-For header', () => {
    expect(() =>
      guard.canActivate(from('203.0.113.9', { 'x-forwarded-for': '192.168.1.20' })),
    ).toThrow(ForbiddenException);
  });

  it('can be turned off', () => {
    process.env.PEEPARR_METADATA_ALLOW_ANY_NETWORK = 'true';
    expect(guard.canActivate(from('8.8.8.8'))).toBe(true);
  });
});
