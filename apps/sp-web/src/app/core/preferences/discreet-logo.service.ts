import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/**
 * Discreet logo: a dark tile with glowing almond rings instead of the
 * figure, in the masthead, sign-in pages, launch splash and browser tab, and
 * as the icon when the app is added to a home screen. Kept per device
 * (localStorage); index.html applies it before the splash paints, this keeps
 * it in step afterwards.
 */
@Injectable({
  providedIn: 'root',
})
export class DiscreetLogoService {
  static readonly STORAGE_KEY = 'peeparr.discreetLogo';
  private static readonly CLASS = 'discreet-logo';

  private readonly document = inject(DOCUMENT);
  private readonly state = signal(this.read());

  readonly enabled = this.state.asReadonly();

  constructor() {
    this.apply(this.state());
  }

  set(enabled: boolean): void {
    this.state.set(enabled);
    try {
      if (enabled) {
        window.localStorage.setItem(DiscreetLogoService.STORAGE_KEY, '1');
      } else {
        window.localStorage.removeItem(DiscreetLogoService.STORAGE_KEY);
      }
    } catch {
      // Private mode: still applies for this visit.
    }
    this.apply(enabled);
  }

  private read(): boolean {
    try {
      return window.localStorage.getItem(DiscreetLogoService.STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private apply(enabled: boolean): void {
    this.document.documentElement.classList.toggle(DiscreetLogoService.CLASS, enabled);
    const icon = this.document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (icon) {
      icon.href = enabled ? 'favicon-discreet.svg' : 'favicon.svg';
    }
    // Read when the app is added to a home screen; an icon already there
    // keeps whichever it was added with.
    const manifest = this.document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) {
      manifest.href = enabled ? 'manifest-discreet.webmanifest' : 'manifest.webmanifest';
    }
    const touchIcon = this.document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (touchIcon) {
      touchIcon.href = enabled ? 'icons/apple-touch-icon-discreet.png' : 'icons/apple-touch-icon.png';
    }
  }
}
