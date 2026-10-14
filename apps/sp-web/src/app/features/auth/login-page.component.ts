import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewChild, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Message } from 'primeng/message';
import { BrandMarkComponent } from '../../shared/brand-mark/brand-mark.component';
import { AuthIntroDirective } from './auth-intro.directive';
import { setNextAppSplash } from '../../shared/app-splash/app-splash.component';
import { AuthService } from '../../core/api/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, Message, BrandMarkComponent, AuthIntroDirective],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
})
export class LoginPageComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  @ViewChild(AuthIntroDirective) private intro?: AuthIntroDirective;

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly resetState = signal<'idle' | 'sending' | 'sent'>('idle');

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
      next: (status) => {
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
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(describeLoginError(error));
      },
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
