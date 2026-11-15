import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { AuthService } from '../../core/api/auth.service';
import { PasskeyService } from '../../core/api/passkey.service';
import { LoginPageComponent } from './login-page.component';

describe('LoginPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  async function setup(
    authService: Partial<Record<keyof AuthService, unknown>>,
    passkeys: Partial<Record<keyof PasskeyService, unknown>> = {},
  ) {
    const passkeyService = {
      supported: () => false,
      label: () => 'Face ID',
      signIn: vi.fn().mockReturnValue(NEVER),
      autofillSupported: vi.fn().mockResolvedValue(true),
      cancel: vi.fn(),
      ...passkeys,
    };
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { status: () => null, ...authService } },
        { provide: PasskeyService, useValue: passkeyService },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
    return { fixture, navigate, navigateByUrl, passkeyService };
  }

  it('offers forgot password instead of creating an admin account', async () => {
    const authService = { requestPasswordReset: vi.fn().mockReturnValue(of(undefined)) };
    const { fixture } = await setup(authService);
    const element: HTMLElement = fixture.nativeElement;

    expect(element.textContent).not.toContain('Create admin account');
    const forgot = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Forgot password?'),
    );
    expect(forgot).toBeTruthy();

    forgot!.click();
    fixture.detectChanges();

    expect(authService.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain('peeparr-reset-password');
  });

  it('sends the admin to change their password after a temporary-password sign in', async () => {
    const authService = {
      login: vi.fn().mockReturnValue(
        of({
          bootstrapRequired: false,
          authenticated: true,
          username: 'admin',
          passwordChangeRequired: true,
        }),
      ),
    };
    const { fixture, navigate, navigateByUrl } = await setup(authService);
    const component = fixture.componentInstance as any;

    component.form.setValue({ username: 'admin', password: 'ABCD-EFGH-JKMN-PQRS' });
    component.submit();

    // After the logo's exit back to the middle of the screen.
    await vi.waitFor(
      () =>
        expect(navigate).toHaveBeenCalledWith(['/settings/account'], {
          queryParams: { reset: 1 },
        }),
      { timeout: 2000 },
    );
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('signs in with Face ID where the browser has passkeys', async () => {
    const signIn = vi
      .fn()
      .mockReturnValue(of({ authenticated: true, bootstrapRequired: false, username: 'admin' }));
    const { fixture, navigateByUrl } = await setup(
      {},
      { supported: () => true, signIn, autofillSupported: vi.fn().mockResolvedValue(false) },
    );
    const button = fixture.nativeElement.querySelector(
      '[data-testid="login-passkey"]',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Sign in with Face ID');

    button.click();

    expect(signIn).toHaveBeenCalledTimes(1);
    // After the logo's exit back to the middle of the screen.
    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith('/'), { timeout: 2000 });
  });

  it('says what to do when there is no passkey, and hides the button without support', async () => {
    const cancelled = Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
    const { fixture } = await setup(
      {},
      { supported: () => true, signIn: vi.fn().mockReturnValue(throwError(() => cancelled)) },
    );
    (fixture.nativeElement.querySelector('[data-testid="login-passkey"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('add a passkey in Settings > Account');
    TestBed.resetTestingModule();

    const plain = await setup({});
    expect(plain.fixture.nativeElement.querySelector('[data-testid="login-passkey"]')).toBeNull();
  });

  it('brings up Face ID as the page opens when the account has a passkey', async () => {
    const signIn = vi
      .fn()
      .mockReturnValue(of({ authenticated: true, bootstrapRequired: false, username: 'admin' }));
    const { navigateByUrl } = await setup(
      {
        status: () => ({
          authenticated: false,
          bootstrapRequired: false,
          username: null,
          passkeys: true,
        }),
      },
      { supported: () => true, signIn },
    );

    expect(signIn).toHaveBeenCalledWith();
    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith('/'), { timeout: 2000 });
  });

  it('cancelled, or just signed out, it waits in the username suggestions instead', async () => {
    const cancelled = Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
    const signedOutStatus = () => ({
      authenticated: false,
      bootstrapRequired: false,
      username: null,
      passkeys: true,
    });
    const signIn = vi
      .fn()
      .mockImplementation((options?: { autofill?: boolean }) =>
        options?.autofill ? NEVER : throwError(() => cancelled),
      );
    const { fixture } = await setup({ status: signedOutStatus }, { supported: () => true, signIn });
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledWith({ autofill: true }));
    // A cancelled automatic prompt isn't an error.
    expect(fixture.nativeElement.querySelector('p-message')).toBeNull();
    TestBed.resetTestingModule();

    sessionStorage.setItem('peeparr.signedOut', '1');
    const afterSignOut = vi.fn().mockReturnValue(NEVER);
    await setup({ status: signedOutStatus }, { supported: () => true, signIn: afterSignOut });
    await vi.waitFor(() => expect(afterSignOut).toHaveBeenCalledWith({ autofill: true }));
    expect(afterSignOut).toHaveBeenCalledTimes(1);
  });
});
