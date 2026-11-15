import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewChild, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Message } from 'primeng/message';
import { BrandMarkComponent } from '../../shared/brand-mark/brand-mark.component';
import { AuthIntroDirective } from './auth-intro.directive';
import { setNextAppSplash } from '../../shared/app-splash/app-splash.component';
import { AuthService } from '../../core/api/auth.service';
import { PasskeyService, isPasskeyCancelled } from '../../core/api/passkey.service';
import { type AuthStatusResponse } from '../../core/api/auth.types';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, Message, BrandMarkComponent, AuthIntroDirective],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
})
export class LoginPageComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly passkeys = inject(PasskeyService);

  @ViewChild(AuthIntroDirective) private intro?: AuthIntroDirective;

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly resetState = signal<'idle' | 'sending' | 'sent'>('idle');
  /** Face ID / Touch ID, where the browser can do passkeys here. */
  protected readonly passkeySupported = this.passkeys.supported();
  protected readonly passkeyLabel = this.passkeys.label();

  protected readonly form = new FormGroup({
    username: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(64)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected submit(): void {
    this.errorMessage.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.authService.login(this.form.getRawValue()).subscribe({
      next: (status) => this.signedIn(status),
      error: (error: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(describeLoginError(error));
      },
    });
  }

  protected signInWithPasskey(): void {
    this.errorMessage.set(null);
    this.submitting.set(true);
    this.passkeys.signIn().subscribe({
      next: (status) => this.signedIn(status),
      error: (error: unknown) => {
        this.submitting.set(false);
        if (isPasskeyCancelled(error)) {
          // Cancelled, or no passkey for this address on this device.
          this.errorMessage.set(
            `No ${this.passkeyLabel === 'a passkey' ? 'passkey' : this.passkeyLabel} sign-in. Sign in with your password, then add a passkey in Settings > Account.`,
          );
          return;
        }
        this.errorMessage.set(
          error instanceof HttpErrorResponse
            ? (readApiMessage(error) ?? 'Could not sign in with the passkey.')
            : 'Could not sign in with the passkey.',
        );
      },
    });
  }

  private signedIn(status: AuthStatusResponse): void {
    // Into the app with the zoom-and-reveal transition: the logo first
    // glides back to the middle, where the splash takes over.
    setNextAppSplash('reveal');
    void (this.intro?.leave() ?? Promise.resolve()).then(() => {
      this.submitting.set(false);
      if (status.passwordChangeRequired) {
        void this.router.navigate(['/settings/account'], {
          queryParams: { reset: 1 },
        });
        return;
      }

      void this.router.navigateByUrl('/');
    });
  }

  protected requestPasswordReset(): void {
    if (this.resetState() === 'sending') {
      return;
    }

    this.errorMessage.set(null);
    this.resetState.set('sending');
    this.authService.requestPasswordReset().subscribe({
      next: () => this.resetState.set('sent'),
      error: (error: unknown) => {
        this.resetState.set('idle');
        this.errorMessage.set(
          error instanceof HttpErrorResponse
            ? (readApiMessage(error) ?? 'Could not start a password reset.')
            : 'Could not start a password reset.',
        );
      },
    });
  }
}

function describeLoginError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) {
      return 'Invalid username or password.';
    }

    if (error.status === 429) {
      return readApiMessage(error) ?? 'Too many login attempts. Wait a minute and try again.';
    }

    if (error.status === 409) {
      return 'No admin account exists yet. Complete first-run bootstrap instead.';
    }

    return readApiMessage(error) ?? 'Failed to sign in.';
  }

  return 'Failed to sign in.';
}

function readApiMessage(error: HttpErrorResponse): string | null {
  const message = error.error?.message;
  if (Array.isArray(message) && message.length > 0) {
    return message[0] ?? null;
  }

  return typeof message === 'string' ? message : null;
}
