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

    // Closes the phone keyboard. It slides away while the logo glides, and
    // the page moves with it: so the logo's target, the middle of the
    // screen, is re-aimed every frame, to be exactly where the launch
    // splash takes over (rather than where the middle was with the
    // keyboard still up -- which made it jolt).
    (document.activeElement as HTMLElement | null)?.blur?.();
    const brand = this.card.querySelector<HTMLElement>('.auth-brand');
    const place = brand ? this.brandPlaceInCard(brand) : null;
    this.measureOffsetToCentre(place);
    this.card.classList.add('auth-leaving');

    return new Promise((resolve) => {
      const until = performance.now() + AuthIntroDirective.LEAVE_MS;
      const follow = (now: number) => {
        this.measureOffsetToCentre(place);
        if (now < until) {
          requestAnimationFrame(follow);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(follow);
    });
  }

  /**
   * The logo's centre relative to the card's corner, measured while it's
   * still in place (the card itself never moves by animation; the logo
   * does, so it's measured from the card).
   */
  private brandPlaceInCard(brand: HTMLElement): { x: number; y: number } {
    const card = this.card.getBoundingClientRect();
    const rect = brand.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - card.left,
      y: rect.top + rect.height / 2 - card.top,
    };
  }

  // From the logo's place in the card to the middle of the screen. The brand
  // is centred in the card, so with the name closed the logo sits at the
  // brand's centre.
  private measureOffsetToCentre(place: { x: number; y: number } | null = null): void {
    const brand = this.card.querySelector<HTMLElement>('.auth-brand');
    if (!brand) {
      return;
    }

    let x: number;
    let y: number;
    if (place) {
      // Where the logo is in the card, wherever the card now is on screen.
      const card = this.card.getBoundingClientRect();
      x = card.left + place.x;
      y = card.top + place.y;
    } else {
      const rect = brand.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    brand.style.setProperty('--intro-dx', `${(window.innerWidth / 2 - x).toFixed(1)}px`);
    brand.style.setProperty('--intro-dy', `${(window.innerHeight / 2 - y).toFixed(1)}px`);
  }
}
