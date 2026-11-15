import { TestBed } from '@angular/core/testing';
import { GuardResult, Router, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { AuthService } from '../api/auth.service';
import {
  bootstrapOnlyWhenRequiredGuard,
  loginOnlyWhenLoggedOutGuard,
  requireAuthenticatedGuard,
  resetFirstAuthCheck,
} from './auth-route.guard';

describe('auth route guards', () => {
  let router: Router;
  let authService: {
    refreshStatus: ReturnType<typeof vi.fn>;
    lockNow: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    resetFirstAuthCheck();
    authService = {
      refreshStatus: vi.fn(),
      lockNow: vi.fn().mockReturnValue(of(undefined)),
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('routes fresh installs to /bootstrap', async () => {
    authService.refreshStatus.mockReturnValue(
      of({
        bootstrapRequired: true,
        authenticated: false,
        username: null,
      }),
    );

    const result = await runGuard(requireAuthenticatedGuard);

    expect(router.serializeUrl(result as UrlTree)).toBe('/bootstrap');
  });

  it('locks an app opened with a lock pending (it was closed), but not later on', async () => {
    authService.refreshStatus.mockReturnValue(
      of({
        bootstrapRequired: false,
        authenticated: true,
        username: 'admin',
        lockOnClose: true,
        lockPending: true,
      }),
    );

    const opened = await runGuard(requireAuthenticatedGuard);
    expect(authService.lockNow).toHaveBeenCalledTimes(1);
    expect(router.serializeUrl(opened as UrlTree)).toBe('/login');

    const later = await runGuard(requireAuthenticatedGuard);
    expect(later).toBe(true);
    expect(authService.lockNow).toHaveBeenCalledTimes(1);
  });

  it('routes existing installs without a session to /login', async () => {
    authService.refreshStatus.mockReturnValue(
      of({
        bootstrapRequired: false,
        authenticated: false,
        username: null,
      }),
    );

    const result = await runGuard(requireAuthenticatedGuard);

    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('allows authenticated users through protected app routes', async () => {
    authService.refreshStatus.mockReturnValue(
      of({
        bootstrapRequired: false,
        authenticated: true,
        username: 'admin',
      }),
    );

    const result = await runGuard(requireAuthenticatedGuard);

    expect(result).toBe(true);
  });

  it('allows /bootstrap only while no admin exists', async () => {
    authService.refreshStatus.mockReturnValue(
      of({
        bootstrapRequired: true,
        authenticated: false,
        username: null,
      }),
    );

    const result = await runGuard(bootstrapOnlyWhenRequiredGuard);

    expect(result).toBe(true);
  });

  it('redirects /login to the app when the admin is already authenticated', async () => {
    authService.refreshStatus.mockReturnValue(
      of({
        bootstrapRequired: false,
        authenticated: true,
        username: 'admin',
      }),
    );

    const result = await runGuard(loginOnlyWhenLoggedOutGuard);

    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });
});

async function runGuard(
  guard: typeof requireAuthenticatedGuard,
  url = '/scenes',
): Promise<GuardResult> {
  const result = TestBed.runInInjectionContext(() => guard({} as never, { url } as never));

  if (isObservable(result)) {
    return firstValueFrom(result);
  }

  return result;
}
