import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../api/auth.service';

/**
 * Lock on close: with it on (Settings > Account), leaving the app starts a
 * short grace time on the server. Back within it (an app switch), nothing
 * happens; past it, or with the app closed, the session ends and opening
 * the app again asks for Face ID or the password.
 *
 * Not while something is playing out loud (picture in picture, AirPlay,
 * background audio): that keeps going.
 */
@Injectable({ providedIn: 'root' })
export class AppLockService {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private listeners: AbortController | null = null;
  private lockSent = false;

  start(): void {
    if (this.listeners || typeof document === 'undefined') {
      return;
    }
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    this.zone.runOutsideAngular(() => {
      document.addEventListener(
        'visibilitychange',
        () => (document.visibilityState === 'hidden' ? this.leaving() : this.back()),
        { signal },
      );
      window.addEventListener('pagehide', () => this.leaving(), { signal });
      window.addEventListener('pageshow', () => this.back(), { signal });
    });
  }

  stop(): void {
    this.listeners?.abort();
    this.listeners = null;
    this.lockSent = false;
  }

  private leaving(): void {
    if (this.lockSent || !this.authService.status()?.lockOnClose || mediaPlaying()) {
      return;
    }
    this.lockSent = true;
    // keepalive: it goes even as the app is closed.
    void fetch('/api/auth/lock', {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  }

  private back(): void {
    if (!this.lockSent || document.visibilityState !== 'visible') {
      return;
    }
    this.lockSent = false;
    this.zone.run(() =>
      this.authService.resume().subscribe({
        error: () => {
          // Too late: locked. Face ID (or the password) to come back in.
          this.authService.clearStatus();
          void this.router.navigateByUrl('/login');
        },
      }),
    );
  }
}

/** Something playing with sound (muted previews don't count). */
function mediaPlaying(): boolean {
  return Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio')).some(
    (media) => !media.paused && !media.ended && !media.muted && media.volume > 0,
  );
}
