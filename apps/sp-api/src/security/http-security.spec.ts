import type { NextFunction, Request, Response } from 'express';
import {
  applyTrustProxy,
  isFromPrivateNetwork,
  trustProxyProblem,
  rejectCrossSiteWrites,
  securityHeaders,
  trustProxySetting,
} from './http-security';

function request(overrides: Partial<Request> & { remoteAddress?: string } = {}): Request {
  const { remoteAddress, ...rest } = overrides;
  return {
    method: 'GET',
    path: '/api/home',
    headers: {},
    socket: { remoteAddress: remoteAddress ?? '192.168.1.20' },
    ip: remoteAddress ?? '192.168.1.20',
    secure: false,
    ...rest,
  } as unknown as Request;
}

function response() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response & typeof res, headers };
}

describe('HTTP security', () => {
  const expressApp = { set: jest.fn() };

  afterEach(() => {
    delete process.env.PEEPARR_TRUST_PROXY;
    applyTrustProxy(expressApp, false);
  });

  describe('trustProxySetting', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['false', false],
      ['1', 1],
      ['2', 2],
      ['10.0.0.2', '10.0.0.2'],
      ['172.16.0.0/12, 127.0.0.1', '172.16.0.0/12, 127.0.0.1'],
      // "Trust everyone" would believe forged headers: one hop instead.
      ['true', 1],
      ['*', 1],
    ])('%p -> %p', (raw, expected) => {
      expect(trustProxySetting({ PEEPARR_TRUST_PROXY: raw })).toEqual(expected);
    });
  });

  describe('isFromPrivateNetwork', () => {
    it('uses the connection address when nothing is forwarded', () => {
      expect(isFromPrivateNetwork(request({ remoteAddress: '10.0.0.5' }))).toBe(true);
      expect(isFromPrivateNetwork(request({ remoteAddress: '203.0.113.9' }))).toBe(false);
    });

    it('refuses proxied requests when no proxy is trusted, even from the proxy on the LAN', () => {
      const proxied = request({
        remoteAddress: '172.18.0.3',
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
      expect(isFromPrivateNetwork(proxied)).toBe(false);
      // A forged header can't turn an outside caller into a local one either.
      const forged = request({ remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '10.0.0.1' } });
      expect(isFromPrivateNetwork(forged)).toBe(false);
    });

    it('with a trusted proxy, judges the client address it reports', () => {
      applyTrustProxy(expressApp, 1);
      expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 1);
      const outside = request({ remoteAddress: '172.18.0.3', ip: '203.0.113.9', headers: { 'x-forwarded-for': '203.0.113.9' } });
      const home = request({ remoteAddress: '172.18.0.3', ip: '192.168.1.50', headers: { 'x-forwarded-for': '192.168.1.50' } });
      expect(isFromPrivateNetwork(outside)).toBe(false);
      expect(isFromPrivateNetwork(home)).toBe(true);
    });
  });

  describe('trustProxyProblem', () => {
    it.each(['', '1', '2', '10.0.0.2', '172.16.0.0/12', '10.0.0.2, 192.168.1.0/24', 'fd00::/8'])(
      'accepts %p',
      (value) => expect(trustProxyProblem(value)).toBeNull(),
    );
    it.each(['0', '9', 'true', '*', 'proxy.local', '10.0.0.0/40', '10.0.0.300'])('refuses %p', (value) =>
      expect(trustProxyProblem(value)).toEqual(expect.any(String)),
    );
  });

  describe('securityHeaders', () => {
    it('sets the protective headers, and HSTS only over HTTPS', () => {
      const next = vi_fn();
      const { res, headers } = response();
      securityHeaders(request(), res, next);
      expect(next).toHaveBeenCalled();
      expect(headers).toMatchObject({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      expect(headers['Content-Security-Policy']).toContain("script-src 'self'");
      expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
      expect(headers['Strict-Transport-Security']).toBeUndefined();

      const secure = response();
      securityHeaders(request({ secure: true }), secure.res, vi_fn());
      expect(secure.headers['Strict-Transport-Security']).toBe('max-age=15552000');
    });
  });

  describe('rejectCrossSiteWrites', () => {
    const run = (req: Request) => {
      const next = vi_fn();
      const { res } = response();
      rejectCrossSiteWrites(req, res, next);
      return { next, res };
    };

    it('lets reads and same-site writes through', () => {
      expect(run(request()).next).toHaveBeenCalled();
      const sameSite = request({
        method: 'POST',
        headers: { origin: 'https://peeparr.example.com', host: 'peeparr.example.com', 'sec-fetch-site': 'same-origin' },
      });
      expect(run(sameSite).next).toHaveBeenCalled();
      // Proxy forwarding the public name while Host is internal.
      const proxied = request({
        method: 'POST',
        headers: { origin: 'https://peeparr.example.com', host: 'peeparr-app:3000', 'x-forwarded-host': 'peeparr.example.com' },
      });
      expect(run(proxied).next).toHaveBeenCalled();
      // Not a browser (no Origin): e.g. scripts, Whisparr.
      expect(run(request({ method: 'POST' })).next).toHaveBeenCalled();
    });

    it('refuses writes from another site', () => {
      const bySite = run(request({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }));
      expect(bySite.next).not.toHaveBeenCalled();
      expect(bySite.res.statusCode).toBe(403);

      const byOrigin = run(
        request({ method: 'DELETE', headers: { origin: 'https://evil.example', host: 'peeparr.example.com' } }),
      );
      expect(byOrigin.next).not.toHaveBeenCalled();
      expect(byOrigin.res.statusCode).toBe(403);
    });
  });
});

function vi_fn(): NextFunction & jest.Mock {
  return jest.fn() as unknown as NextFunction & jest.Mock;
}
