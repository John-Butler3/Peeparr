import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { AuthStatusResponse } from './auth.types';
import { LoginAttemptService } from './login-attempt.service';

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PendingChallenge {
  challenge: string;
  origin: string;
  rpId: string;
  /** Set for a registration: whose passkey it is. */
  userId: string | null;
  expiresAt: number;
}

/**
 * Passkeys for the admin: Face ID or Touch ID on an iPhone or Mac (or any
 * platform authenticator or security key), as a way to sign in besides the
 * password. A passkey belongs to the address it was made on (its relying
 * party is that host name), which must be HTTPS -- or localhost.
 *
 * Each ceremony gets a one-time challenge, kept here for five minutes and
 * used once.
 */
@Injectable()
export class PasskeyService {
  static readonly CHALLENGE_TTL_MS = 5 * 60 * 1000;
  static readonly MAX_PASSKEYS = 20;
  private static readonly RP_NAME = 'Peeparr';

  private readonly challenges = new Map<string, PendingChallenge>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly loginAttemptService: LoginAttemptService,
  ) {}

  async list(request: Request, response: Response): Promise<PasskeySummary[]> {
    const { user } = await this.authService.requireAuthenticatedRequest(
      request,
      response,
    );
    const passkeys = await this.prisma.adminPasskey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return passkeys.map((passkey) => ({
      id: passkey.id,
      name: passkey.name,
      createdAt: passkey.createdAt.toISOString(),
      lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async registrationOptions(
    request: Request,
    response: Response,
  ): Promise<{
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  }> {
    const { user } = await this.authService.requireAuthenticatedRequest(
      request,
      response,
    );
    const { origin, rpId } = this.relyingParty(request);
    const existing = await this.prisma.adminPasskey.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });
    if (existing.length >= PasskeyService.MAX_PASSKEYS) {
      throw new BadRequestException(
        'That is as many passkeys as an account can have. Remove one first.',
      );
    }
    const options = await generateRegistrationOptions({
      rpName: PasskeyService.RP_NAME,
      rpID: rpId,
      userName: user.username,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      // A passkey (findable without typing the username), with Face ID /
      // Touch ID or the device's passcode.
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      })),
    });
    const challengeId = this.remember({
      challenge: options.challenge,
      origin,
      rpId,
      userId: user.id,
    });
    return { challengeId, options };
  }

  async register(
    request: Request,
    response: Response,
    body: {
      challengeId: string;
      response: RegistrationResponseJSON;
      name?: string;
    },
  ): Promise<PasskeySummary> {
    const { user } = await this.authService.requireAuthenticatedRequest(
      request,
      response,
    );
    const pending = this.take(body.challengeId);
    if (!pending || pending.userId !== user.id) {
      throw new BadRequestException(
        'That passkey request has expired. Please try again.',
      );
    }
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpId,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new BadRequestException(
        `The passkey couldn't be checked: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException("The passkey couldn't be checked.");
    }
    const { credential } = verification.registrationInfo;
    const passkey = await this.prisma.adminPasskey.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        name: this.passkeyName(body.name, request),
      },
    });
    return {
      id: passkey.id,
      name: passkey.name,
      createdAt: passkey.createdAt.toISOString(),
      lastUsedAt: null,
    };
  }

  async remove(
    request: Request,
    response: Response,
    passkeyId: string,
  ): Promise<void> {
    const { user } = await this.authService.requireAuthenticatedRequest(
      request,
      response,
    );
    const { count } = await this.prisma.adminPasskey.deleteMany({
      where: { id: passkeyId, userId: user.id },
    });
    if (count === 0) {
      throw new NotFoundException('No such passkey.');
    }
  }

  async authenticationOptions(request: Request): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const { origin, rpId } = this.relyingParty(request);
    // No list of credentials: the device offers whichever passkey it has
    // for this address.
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
    });
    const challengeId = this.remember({
      challenge: options.challenge,
      origin,
      rpId,
      userId: null,
    });
    return { challengeId, options };
  }

  async login(
    request: Request,
    response: Response,
    body: { challengeId: string; response: AuthenticationResponseJSON },
  ): Promise<AuthStatusResponse> {
    const ipKey = `passkey:${request.ip || request.socket.remoteAddress || 'unknown'}`;
    this.loginAttemptService.assertAllowed(ipKey);

    const pending = this.take(body.challengeId);
    if (!pending || pending.userId !== null) {
      throw new BadRequestException(
        'That sign-in request has expired. Please try again.',
      );
    }
    const passkey = await this.prisma.adminPasskey.findUnique({
      where: { credentialId: body.response.id },
      include: { user: true },
    });
    if (!passkey) {
      this.loginAttemptService.recordFailure(ipKey);
      throw new UnauthorizedException(
        "This passkey isn't registered here (it may have been removed). Sign in with your password.",
      );
    }
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpId,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch {
      verification = { verified: false } as typeof verification;
    }
    if (!verification.verified) {
      this.loginAttemptService.recordFailure(ipKey);
      throw new UnauthorizedException("The passkey couldn't be verified.");
    }
    this.loginAttemptService.clear(ipKey);
    await this.prisma.adminPasskey.update({
      where: { id: passkey.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });
    return this.authService.signIn(passkey.user, request, response);
  }

  /**
   * The address the browser is on (its Origin, which the cross-site check
   * already holds to this server's own host), as the passkey's relying
   * party. Passkeys need HTTPS, except on localhost.
   */
  private relyingParty(request: Request): { origin: string; rpId: string } {
    const origin = request.headers.origin;
    let url: URL | null = null;
    try {
      url = origin && origin !== 'null' ? new URL(origin) : null;
    } catch {
      url = null;
    }
    const hosts = [
      request.headers.host,
      firstValue(request.headers['x-forwarded-host']),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    if (!url || !hosts.includes(url.host.toLowerCase())) {
      throw new BadRequestException(
        'Passkeys need a request from the Peeparr page itself.',
      );
    }
    const local =
      url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
    if (url.protocol !== 'https:' && !local) {
      throw new ForbiddenException(
        'Passkeys only work when Peeparr is opened over HTTPS, at its domain name.',
      );
    }
    return { origin: url.origin, rpId: url.hostname };
  }

  private remember(entry: Omit<PendingChallenge, 'expiresAt'>): string {
    const now = Date.now();
    for (const [id, pending] of this.challenges) {
      if (pending.expiresAt <= now) {
        this.challenges.delete(id);
      }
    }
    const id = randomUUID();
    this.challenges.set(id, {
      ...entry,
      expiresAt: now + PasskeyService.CHALLENGE_TTL_MS,
    });
    return id;
  }

  /** The challenge, once: gone after this whatever happens. */
  private take(challengeId: string): PendingChallenge | null {
    const pending = this.challenges.get(challengeId);
    this.challenges.delete(challengeId);
    return pending && pending.expiresAt > Date.now() ? pending : null;
  }

  private passkeyName(given: string | undefined, request: Request): string {
    const name = given?.trim().slice(0, 60);
    if (name) {
      return name;
    }
    const agent = request.headers['user-agent'] ?? '';
    if (/iPhone/.test(agent)) return 'iPhone';
    if (/iPad/.test(agent)) return 'iPad';
    if (/Macintosh/.test(agent)) return 'Mac';
    if (/Android/.test(agent)) return 'Android';
    if (/Windows/.test(agent)) return 'Windows';
    return 'Passkey';
  }
}

function firstValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim() || undefined;
}
