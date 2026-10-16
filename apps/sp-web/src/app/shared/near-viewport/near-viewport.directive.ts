import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';

/**
 * Infinite scroll: emits `nearViewport` with true when the element comes
 * within `nearViewportMargin` of the screen (and false when it leaves). Put
 * it on a marker after a list and load the next page while it's true.
 */
@Directive({
  selector: '[appNearViewport]',
})
export class NearViewportDirective implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private observer: IntersectionObserver | null = null;

  /** How far ahead of the screen counts as near (CSS margin). */
  @Input() nearViewportMargin = '600px 0px';
  @Output() readonly nearViewport = new EventEmitter<boolean>();

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) {
          this.zone.run(() => this.nearViewport.emit(entry.isIntersecting));
        }
      },
      { rootMargin: this.nearViewportMargin },
    );
    this.observer.observe(this.element);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
