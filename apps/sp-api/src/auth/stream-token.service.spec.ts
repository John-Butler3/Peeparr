import { PrismaService } from '../prisma/prisma.service';
import { StreamTokenService } from './stream-token.service';

describe('StreamTokenService', () => {
  const user = {
    id: 'cuser1',
    username: 'admin',
    normalizedUsername: 'admin',
    sessionVersion: 3,
  };
  let sessionVersion: number;
  let service: StreamTokenService;

  beforeEach(() => {
    sessionVersion = 3;
    const prisma = {
      adminUser: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === user.id ? { sessionVersion } : null),
        ),
      },
    } as unknown as PrismaService;
    service = new StreamTokenService(prisma);
  });

  it("opens the scene's video it was issued for", async () => {
    const token = service.issue('412', user);
    await expect(service.verify(token, '412')).resolves.toBe(true);
    // Never the session id: just who, which sign-in generation, until when.
    expect(token.split('.')).toHaveLength(4);
  });

  it('not another scene', async () => {
    await expect(
      service.verify(service.issue('412', user), '413'),
    ).resolves.toBe(false);
  });

  it('not once it has expired', async () => {
    const issuedAt = Date.now();
    const token = service.issue('412', user, issuedAt);
    await expect(
      service.verify(
        token,
        '412',
        issuedAt + StreamTokenService.STREAM_TOKEN_TTL_MS + 1000,
      ),
    ).resolves.toBe(false);
  });

  it('not after signing out everywhere or a password change', async () => {
    const token = service.issue('412', user);
    sessionVersion = 4;
    await expect(service.verify(token, '412')).resolves.toBe(false);
  });

  it('not when altered or made up', async () => {
    const [id, version, expires, signature] = service
      .issue('412', user)
      .split('.');
    const later = String(Number(expires) + 86_400);
    await expect(
      service.verify([id, version, later, signature].join('.'), '412'),
    ).resolves.toBe(false);
    for (const junk of [
      undefined,
      '',
      'a.b.c',
      'a.b.c.d',
      ['x'],
      'x'.repeat(300),
    ]) {
      await expect(service.verify(junk, '412')).resolves.toBe(false);
    }
  });
});
