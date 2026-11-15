import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { Observable, from, switchMap, tap } from 'rxjs';
import { AuthStateStore } from './auth-state.store';
import { type AuthStatusResponse } from './auth.types';

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Passkeys: signing in with Face ID / Touch ID (or a security key) instead
 * of typing the password. The browser does the asking; the server checks.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyService {
  private readonly http = inject(HttpClient);
  private readonly authStateStore = inject(AuthStateStore);

  /** Whether this browser, on this address, can use passkeys at all. */
  supported(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext && browserSupportsWebAuthn();
  }

  /** "Face ID" on an iPhone or iPad, "Touch ID" on a Mac, else "a passkey". */
  label(): string {
    const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    if (/iPhone|iPad/.test(agent)) {
      return 'Face ID';
    }
    if (/Macintosh/.test(agent)) {
      return 'Touch ID';
    }
    return 'a passkey';
  }

  list(): Observable<Passkey[]> {
    return this.http.get<Passkey[]>('/api/auth/passkeys');
  }

  /** Makes a passkey on this device for the signed-in admin (Face ID asks). */
  register(name?: string): Observable<Passkey> {
    return this.http
      .post<{
        challengeId: string;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>('/api/auth/passkeys/register/options', {})
      .pipe(
        switchMap(({ challengeId, options }) =>
          from(startRegistration({ optionsJSON: options })).pipe(
            switchMap((response) =>
              this.http.post<Passkey>('/api/auth/passkeys/register', {
                challengeId,
                response,
                name,
              }),
            ),
          ),
        ),
      );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/auth/passkeys/${encodeURIComponent(id)}`);
  }

  /** Signs in with a passkey this device has for this address. */
  signIn(): Observable<AuthStatusResponse> {
    return this.http
      .post<{
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>('/api/auth/passkeys/login/options', {})
      .pipe(
        switchMap(({ challengeId, options }) =>
          from(startAuthentication({ optionsJSON: options })).pipe(
            switchMap((response) =>
              this.http.post<AuthStatusResponse>('/api/auth/passkeys/login', {
                challengeId,
                response,
              }),
            ),
          ),
        ),
        tap((status) => this.authStateStore.sync(status)),
      );
  }
}

/** The browser's own refusal (cancelled, timed out, no passkey here). */
export function isPasskeyCancelled(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}
