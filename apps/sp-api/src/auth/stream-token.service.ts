import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedAdmin } from './auth.types';

/**
 * Tokens for a scene's video URL, for players that fetch it themselves and
 * so don't send the session cookie: AirPlay (an Apple TV is handed the URL
 * and requests it directly) and similar receivers.
 *
 * A token opens one scene's video, for STREAM_TOKEN_TTL_MS, and only while
 * the account's sessions are valid (signing out everywhere or changing the
 * password bumps sessionVersion and voids it). It never carries the session
 * id itself, so a token seen in a URL can't be turned into a sign-in.
 */
@Injectable()
export class StreamTokenService {
  static readonly STREAM_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

  private readonly key: Buffer;

  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.SESSION_SECRET?.trim() || 'test-session-secret';
    // Its own key, derived from the session secret: a stream token's
    // signature can never double as a cookie's.
    this.key = createHmac('sha256', secret)
      .update('peeparr:stream-token:v1')
      .digest();
  }

  issue(sceneId: string, user: AuthenticatedAdmin, now = Date.now()): string {
    const expires = Math.floor(
      (now + StreamTokenService.STREAM_TOKEN_TTL_MS) / 1000,
    );
    const body = `${user.id}.${user.sessionVersion}.${expires}`;
    return `${body}.${this.sign(sceneId, body)}`;
  }

  /** Whether `token` opens this scene's video now. */
  async verify(
    token: unknown,
    sceneId: string,
    now = Date.now(),
  ): Promise<boolean> {
    if (typeof token !== 'string' || token.length > 256) {
      return false;
    }
    const parts = token.split('.');
    if (parts.length !== 4) {
      return false;
    }
    const [userId, version, expires, signature] = parts;
    const body = `${userId}.${version}.${expires}`;
    if (!safeEqual(signature, this.sign(sceneId, body))) {
      return false;
    }
    if (!/^\d+$/.test(expires) || Number(expires) * 1000 <= now) {
      return false;
    }
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    return !!user && String(user.sessionVersion) === version;
  }

  private sign(sceneId: string, body: string): string {
    return createHmac('sha256', this.key)
      .update(`${sceneId}\n${body}`)
      .digest('base64url');
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
