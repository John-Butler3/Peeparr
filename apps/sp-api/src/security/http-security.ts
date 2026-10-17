import { PORNHUB_EMBED_ORIGIN } from '../scenes/streaming/pornhub-embed.util';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { BlockList, isIP } from 'node:net';

/**
 * HTTP-level protection for running Peeparr behind a reverse proxy (and
 * without one): which proxy to trust for the client's address, security
 * headers, and refusing cross-site requests that change things.
 */

const logger = new Logger('HttpSecurity');

/**
 * PEEPARR_TRUST_PROXY: the reverse proxy in front of Peeparr, so the real
 * client address (for sign-in limits and private-network checks) and HTTPS
 * are read from its X-Forwarded-* headers. A hop count ("1") or the proxy's
 * addresses ("10.0.0.2", "172.16.0.0/12"). Unset: no proxy is trusted.
 * "true" would trust addresses anyone can fake, so it's read as one hop.
 */
export function trustProxySetting(
  env: NodeJS.ProcessEnv = process.env,
): number | string | false {
  return parseTrustProxy(env.PEEPARR_TRUST_PROXY);
}

/** A trust-proxy value as Express takes it: hops, addresses, or false. */
export function parseTrustProxy(
  value: string | null | undefined,
): number | string | false {
  const raw = value?.trim();
  if (!raw || raw.toLowerCase() === 'false' || raw === '0') {
    return false;
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  if (raw.toLowerCase() === 'true' || raw === '*') {
    return 1;
  }
  return raw;
}

/**
 * Why a remote-access value can't be used, or null if it can: a hop count
 * (1-5), or comma-separated proxy addresses / networks.
 */
export function trustProxyProblem(value: string): string | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return hops >= 1 && hops <= 5
      ? null
      : 'Use a number of proxies from 1 to 5.';
  }
  for (const part of raw.split(',').map((p) => p.trim())) {
    const [address, prefix, extra] = part.split('/');
    const family = isIP(address ?? '');
    const maxPrefix = family === 4 ? 32 : 128;
    const prefixOk =
      prefix === undefined ||
      (/^\d+$/.test(prefix) && Number(prefix) <= maxPrefix);
    if (!family || !prefixOk || extra !== undefined) {
      return `"${part}" isn't an IP address or network (like 10.0.0.2 or 172.16.0.0/12).`;
    }
  }
  return null;
}

// What's in effect: PEEPARR_TRUST_PROXY, else the Remote access setting.
let effectiveTrustProxy: number | string | false = false;

export function currentTrustProxy(): number | string | false {
  return effectiveTrustProxy;
}

/** Applies a trust-proxy value now (no restart): Express and the checks below. */
export function applyTrustProxy(
  expressApp: { set(setting: string, value: unknown): unknown },
  value: number | string | false,
): void {
  effectiveTrustProxy = value;
  expressApp.set('trust proxy', value);
}

const PRIVATE = (() => {
  const list = new BlockList();
  list.addSubnet('127.0.0.0', 8, 'ipv4');
  list.addSubnet('10.0.0.0', 8, 'ipv4');
  list.addSubnet('172.16.0.0', 12, 'ipv4');
  list.addSubnet('192.168.0.0', 16, 'ipv4');
  list.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT, Tailscale
  list.addSubnet('169.254.0.0', 16, 'ipv4');
  list.addAddress('::1', 'ipv6');
  list.addSubnet('fc00::', 7, 'ipv6');
  list.addSubnet('fe80::', 10, 'ipv6');
  return list;
})();

export function isPrivateAddress(address: string | undefined | null): boolean {
  if (!address) {
    return false;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const ip = mapped ?? address;
  const family = isIP(ip);
  return family !== 0 && PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const FORWARDING_HEADERS = [
  'x-forwarded-for',
  'forwarded',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
] as const;

/**
 * Whether a request comes from a private network. Directly, that's the
 * connection's address. Through a proxy (which sits on the private network
 * itself, so its address proves nothing) it's the client's address as
 * reported by a trusted proxy -- and with no proxy trusted, it's refused.
 * Headers a client can fake are never believed on their own.
 */
export function isFromPrivateNetwork(request: Request): boolean {
  const forwarded = FORWARDING_HEADERS.some(
    (header) => request.headers[header] !== undefined,
  );
  if (!forwarded) {
    return isPrivateAddress(request.socket.remoteAddress);
  }
  // request.ip is the client as reported by the trusted proxy (Express
  // walks X-Forwarded-For back to the first address it doesn't trust).
  return currentTrustProxy() !== false ? isPrivateAddress(request.ip) : false;
}

/** Security headers on every response. */
export function securityHeaders(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  // Nothing about what you were looking at goes to other sites you open.
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // Angular and PrimeNG set styles inline.
      "style-src 'self' 'unsafe-inline'",
      // Catalog pictures come from StashDB / ThePornDB image servers.
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
      // Pornhub's embed player, for scenes streamed from Pornhub (an
      // optional setting); no other site can be framed.
      `frame-src ${PORNHUB_EMBED_ORIGIN}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  if (request.secure) {
    response.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  next();
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refuses API requests that change things when they come from another site
 * (on top of the SameSite session cookie). Same-site browser requests, and
 * anything not from a browser (no Origin header), are let through.
 */
export function rejectCrossSiteWrites(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (
    !UNSAFE_METHODS.has(request.method) ||
    !request.path.startsWith('/api/')
  ) {
    next();
    return;
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    response
      .status(403)
      .json({
        statusCode: 403,
        message: 'Cross-site requests are not allowed.',
      });
    return;
  }
  const origin = request.headers.origin;
  if (origin && origin !== 'null') {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    // The address the browser used: Host, or the proxy's X-Forwarded-Host
    // (a cross-site page can't set that header without failing CORS).
    const hosts = [
      request.headers.host,
      firstValue(request.headers['x-forwarded-host']),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    if (!originHost || !hosts.includes(originHost)) {
      response
        .status(403)
        .json({
          statusCode: 403,
          message: 'Cross-site requests are not allowed.',
        });
      return;
    }
  }
  next();
}

function firstValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim();
}

export function applyHttpSecurity(app: NestExpressApplication): void {
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  const trust = trustProxySetting();
  if (/^(true|\*)$/i.test(process.env.PEEPARR_TRUST_PROXY?.trim() ?? '')) {
    logger.warn(
      'PEEPARR_TRUST_PROXY=true would trust any sender; treating it as one proxy hop (1).',
    );
  }
  // From the environment now; otherwise the Remote access setting is applied
  // once the app has started (NetworkSettingsService).
  applyTrustProxy(express, trust);
  if (trust !== false) {
    logger.log(`Trusting the reverse proxy: ${String(trust)}`);
  }
  app.use(securityHeaders);
  app.use(rejectCrossSiteWrites);
}
