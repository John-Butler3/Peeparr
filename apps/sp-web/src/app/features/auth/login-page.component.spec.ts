import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/api/auth.service';
import { LoginPageComponent } from './login-page.component';

describe('LoginPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function setup(authService: Partial<Record<keyof AuthService, unknown>>) {
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
    return { fixture, navigate, navigateByUrl };
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
    expect(element.textContent).toContain('stasharr-reset-password');
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
});
