import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as webauthn from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { LoginAttemptService } from './login-attempt.service';
import { PasskeyService } from './passkey.service';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

const mocked = webauthn as jest.Mocked<typeof webauthn>;

function request(origin: string, host = 'peeparr.example.com'): Request {
  return {
    headers: {
      origin,
      host,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)',
    },
    ip: '203.0.113.9',
    socket: {},
  } as unknown as Request;
}

describe('PasskeyService', () => {
  const admin = {
    id: 'u1',
    username: 'admin',
    normalizedUsername: 'admin',
    sessionVersion: 3,
  };
  const response = {} as Response;
  let prisma: {
    adminPasskey: Record<string, jest.Mock>;
  };
  let authService: {
    requireAuthenticatedRequest: jest.Mock;
    signIn: jest.Mock;
  };
  let service: PasskeyService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma = {
      adminPasskey: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn(),
      },
    };
    authService = {
      requireAuthenticatedRequest: jest
        .fn()
        .mockResolvedValue({ user: admin, sessionId: 's1' }),
      signIn: jest
        .fn()
        .mockResolvedValue({
          authenticated: true,
          bootstrapRequired: false,
          username: 'admin',
        }),
    };
    service = new PasskeyService(
      prisma as never,
      authService as never,
      new LoginAttemptService(),
    );
    mocked.generateRegistrationOptions.mockResolvedValue({
      challenge: 'reg-challenge',
    } as never);
    mocked.generateAuthenticationOptions.mockResolvedValue({
      challenge: 'login-challenge',
    } as never);
  });

  it('registers a passkey for the address the page is on, named after the device', async () => {
    const req = request('https://peeparr.example.com');
    const { challengeId } = await service.registrationOptions(req, response);
    expect(mocked.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: 'peeparr.example.com',
        userName: 'admin',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      }),
    );

    mocked.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
      },
    } as never);
    prisma.adminPasskey.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'p1',
        ...data,
        createdAt: new Date('2026-11-16T09:00:00Z'),
      }),
    );

    const passkey = await service.register(req, response, {
      challengeId,
      response: { id: 'cred-1' } as never,
    });

    expect(mocked.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'reg-challenge',
        expectedOrigin: 'https://peeparr.example.com',
        expectedRPID: 'peeparr.example.com',
        requireUserVerification: true,
      }),
    );
    expect(prisma.adminPasskey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        credentialId: 'cred-1',
        name: 'iPhone',
      }),
    });
    expect(passkey.name).toBe('iPhone');

    // The challenge is spent.
    await expect(
      service.register(req, response, {
        challengeId,
        response: { id: 'cred-1' } as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses plain HTTP (but not localhost) and another site', async () => {
    await expect(
      service.authenticationOptions(
        request('http://10.0.0.5:3000', '10.0.0.5:3000'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.authenticationOptions(
        request('https://evil.example', 'peeparr.example.com'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.authenticationOptions(
        request('http://localhost:4200', 'localhost:4200'),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ challengeId: expect.any(String) }),
    );
  });

  it('signs in with a verified passkey and keeps its counter', async () => {
    const req = request('https://peeparr.example.com');
    const { challengeId } = await service.authenticationOptions(req);
    prisma.adminPasskey.findUnique.mockResolvedValue({
      id: 'p1',
      credentialId: 'cred-1',
      publicKey: Buffer.from([1, 2, 3]),
      counter: 4,
      transports: ['internal'],
      user: admin,
    });
    mocked.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    } as never);

    const status = await service.login(req, response, {
      challengeId,
      response: { id: 'cred-1' } as never,
    });

    expect(status.authenticated).toBe(true);
    expect(authService.signIn).toHaveBeenCalledWith(admin, req, response);
    expect(prisma.adminPasskey.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { counter: 5, lastUsedAt: expect.any(Date) },
    });
  });

  it('turns away an unknown or unverified passkey', async () => {
    const req = request('https://peeparr.example.com');
    let { challengeId } = await service.authenticationOptions(req);
    prisma.adminPasskey.findUnique.mockResolvedValue(null);
    await expect(
      service.login(req, response, {
        challengeId,
        response: { id: 'nope' } as never,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    ({ challengeId } = await service.authenticationOptions(req));
    prisma.adminPasskey.findUnique.mockResolvedValue({
      id: 'p1',
      credentialId: 'cred-1',
      publicKey: Buffer.from([1]),
      counter: 0,
      transports: [],
      user: admin,
    });
    mocked.verifyAuthenticationResponse.mockRejectedValue(
      new Error('bad signature'),
    );
    await expect(
      service.login(req, response, {
        challengeId,
        response: { id: 'cred-1' } as never,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.signIn).not.toHaveBeenCalled();
  });
});
