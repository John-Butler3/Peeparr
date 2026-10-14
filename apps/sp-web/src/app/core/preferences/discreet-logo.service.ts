import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/**
 * Discreet logo: the red tile with just an almond outline instead of the
 * figure, in the masthead, sign-in pages, launch splash and browser tab.
 * Kept per device (localStorage); index.html applies it before the splash
 * paints, this keeps it in step afterwards.
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
  }
}
