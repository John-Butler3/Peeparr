import { Component, ElementRef, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';

/**
 * The watched line along the bottom of a thumbnail (in a positioned parent).
 * Cleared, it slides back to nothing rather than vanishing.
 */
@Component({
  selector: 'app-progress-line',
  styleUrl: './progress-line.component.scss',
  template: `
    @if (shown() !== null) {
      <div
        class="progress-track"
        [class.is-clearing]="shown() === 0"
        role="progressbar"
        [attr.aria-valuenow]="shown()"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="'Watched ' + shown() + '%'"
      >
        <div class="progress-fill" [style.width.%]="shown()"></div>
      </div>
    }
  `,
})
export class ProgressLineComponent implements OnChanges, OnDestroy {
  /** A little longer than the slide (--motion-slow). */
  static readonly CLEAR_MS = 400;

  @Input() percent: number | null = null;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly shown = signal<number | null>(null);
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(): void {
    this.cancelClear();
    if (this.percent !== null && this.percent > 0) {
      this.shown.set(this.percent);
    } else if (this.shown()) {
      // On a page just come back to, the line has no drawn width to slide
      // from until something asks for it.
      const fill = this.host.querySelector('.progress-fill');
      if (fill) {
        void getComputedStyle(fill).width;
      }
      this.shown.set(0);
      this.clearTimer = setTimeout(() => this.shown.set(null), ProgressLineComponent.CLEAR_MS);
    } else {
      this.shown.set(null);
    }
  }

  ngOnDestroy(): void {
    this.cancelClear();
  }

  private cancelClear(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }
}
