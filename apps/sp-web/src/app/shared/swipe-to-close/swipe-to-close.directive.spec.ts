import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwipeToCloseDirective } from './swipe-to-close.directive';

@Component({
  imports: [SwipeToCloseDirective],
  template: `
    <div #backdrop class="backdrop"></div>
    <section class="sheet" appSwipeToClose [swipeBackdrop]="backdrop" (swipeClose)="closed = closed + 1"></section>
  `,
})
class HostComponent {
  closed = 0;
}

// jsdom has no Touch: a plain event carrying what the directive reads.
function touch(type: string, y: number, timeStamp: number): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientY: y }] });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  return event;
}

describe('SwipeToCloseDirective', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const sheet = fixture.nativeElement.querySelector('.sheet') as HTMLElement;
    const backdrop = fixture.nativeElement.querySelector('.backdrop') as HTMLElement;
    Object.defineProperty(sheet, 'offsetHeight', { value: 400 });
    const drag = (to: number, ms: number) => {
      sheet.dispatchEvent(touch('touchstart', 100, 0));
      const move = touch('touchmove', 100 + to, ms / 2);
      sheet.dispatchEvent(move);
      sheet.dispatchEvent(touch('touchmove', 100 + to, ms));
      sheet.dispatchEvent(touch('touchend', 100 + to, ms));
      return move;
    };
    return { fixture, sheet, backdrop, drag };
  }

  it('follows the finger and closes when dragged far enough', () => {
    const { fixture, sheet, backdrop, drag } = render();

    const move = drag(150, 1000);
    expect(move.defaultPrevented).toBe(true);
    expect(sheet.style.transform).toBe('translateY(400px)');
    expect(Number(backdrop.style.opacity)).toBe(0);
    expect(fixture.componentInstance.closed).toBe(0);

    vi.advanceTimersByTime(SwipeToCloseDirective.ANIMATION_MS);
    expect(fixture.componentInstance.closed).toBe(1);
    expect(sheet.style.transform).toBe('');
  });

  it('springs back from a short, slow drag', () => {
    const { fixture, sheet, drag } = render();

    drag(40, 1000);
    vi.advanceTimersByTime(SwipeToCloseDirective.ANIMATION_MS);

    expect(fixture.componentInstance.closed).toBe(0);
    expect(sheet.style.transform).toBe('');
  });

  it('closes on a quick flick', () => {
    const { fixture, drag } = render();

    drag(60, 50);
    vi.advanceTimersByTime(SwipeToCloseDirective.ANIMATION_MS);

    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('leaves scrolling alone: up, or down when the sheet is scrolled', () => {
    const { fixture, sheet, drag } = render();

    const up = drag(-150, 1000);
    expect(up.defaultPrevented).toBe(false);

    sheet.scrollTop = 0;
    Object.defineProperty(sheet, 'scrollTop', { value: 120 });
    const down = drag(150, 1000);
    expect(down.defaultPrevented).toBe(false);

    vi.advanceTimersByTime(SwipeToCloseDirective.ANIMATION_MS);
    expect(fixture.componentInstance.closed).toBe(0);
  });
});
