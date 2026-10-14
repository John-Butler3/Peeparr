import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Sign-in intro on the auth card: the logo plays its slide-out dead centre
 * on an empty screen -- at the launch splash's size, where the splash left
 * it -- rises to its place in the card, then the card and form fade in
 * (styles in _auth-card.scss, `.auth-intro`). The offset from the logo's
 * place to the middle of the screen is measured before the first paint;
 * until then the card is hidden so nothing jumps. `leave()` plays it back
 * to the middle for the launch splash to take over after signing in.
 */
@Directive({
  selector: '[appAuthIntro]',
  exportAs: 'authIntro',
})
export class AuthIntroDirective {
  /** Matches the .auth-leaving animations. */
  static readonly LEAVE_MS = 600;

  private readonly card = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      return;
    }

    this.card.classList.add('auth-intro-pending');
    afterNextRender(() => {
      this.measureOffsetToCentre();
      this.card.classList.replace('auth-intro-pending', 'auth-intro');
    });
  }

  /** Plays the logo back to the middle of the screen (then resolves). */
  leave(): Promise<void> {
    if (!this.card.classList.contains('auth-intro')) {
      return Promise.resolve();
    }

    // Closes the phone keyboard, so the layout settles before measuring.
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.measureOffsetToCentre();
    this.card.classList.add('auth-leaving');
    return new Promise((resolve) => setTimeout(resolve, AuthIntroDirective.LEAVE_MS));
  }

  // From the logo's place in the card to the middle of the screen. The brand
  // is centred in the card, so with the name closed the logo sits at the
  // brand's centre.
  private measureOffsetToCentre(): void {
    const brand = this.card.querySelector<HTMLElement>('.auth-brand');
    if (!brand) {
      return;
    }

    const rect = brand.getBoundingClientRect();
    const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
    const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
    brand.style.setProperty('--intro-dx', `${Math.round(dx)}px`);
    brand.style.setProperty('--intro-dy', `${Math.round(dy)}px`);
  }
}
