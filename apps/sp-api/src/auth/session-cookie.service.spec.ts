import type { Response } from 'express';
import { SessionCookieService } from './session-cookie.service';

function response(secure: boolean) {
  const cookie = jest.fn();
  return { res: { cookie, clearCookie: jest.fn(), req: { secure } } as unknown as Response, cookie };
}

describe('SessionCookieService secure flag', () => {
  afterEach(() => {
    delete process.env.SESSION_COOKIE_SECURE;
  });

  it('follows HTTPS by default', () => {
    const service = new SessionCookieService();
    const https = response(true);
    const http = response(false);

    service.setSessionCookie(https.res, 'abc', new Date(Date.now() + 1000));
    service.setSessionCookie(http.res, 'abc', new Date(Date.now() + 1000));

    expect(https.cookie.mock.calls[0][2]).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax' });
    expect(http.cookie.mock.calls[0][2]).toMatchObject({ secure: false });
  });

  it('SESSION_COOKIE_SECURE=true forces it; older installs\' false still follows HTTPS', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    const forced = response(false);
    new SessionCookieService().setSessionCookie(forced.res, 'abc', new Date(Date.now() + 1000));
    expect(forced.cookie.mock.calls[0][2]).toMatchObject({ secure: true });

    process.env.SESSION_COOKIE_SECURE = 'false';
    const https = response(true);
    new SessionCookieService().setSessionCookie(https.res, 'abc', new Date(Date.now() + 1000));
    expect(https.cookie.mock.calls[0][2]).toMatchObject({ secure: true });
  });
});
