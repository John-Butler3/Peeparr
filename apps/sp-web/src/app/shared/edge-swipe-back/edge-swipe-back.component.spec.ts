import { TestBed } from '@angular/core/testing';
import { NavigationHistoryService } from '../../core/navigation/navigation-history.service';
import { EdgeSwipeBackComponent } from './edge-swipe-back.component';

// jsdom has no Touch: a plain event carrying what the component reads.
function touch(type: string, x: number, y: number, timeStamp: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  return event;
}

describe('EdgeSwipeBackComponent', () => {
  let target: HTMLElement;

  afterEach(() => {
    target.remove();
    TestBed.resetTestingModule();
  });

  function render(canGoBack = true) {
    const history = { canGoBack: vi.fn(() => canGoBack), back: vi.fn(() => true) };
    TestBed.configureTestingModule({
      imports: [EdgeSwipeBackComponent],
      providers: [{ provide: NavigationHistoryService, useValue: history }],
    });
    const fixture = TestBed.createComponent(EdgeSwipeBackComponent);
    fixture.detectChanges();
    target = document.createElement('div');
    document.body.appendChild(target);
    const arrow = fixture.nativeElement.querySelector('.edge-back') as HTMLElement;
    const swipe = (from: number, to: number, ms: number, el: HTMLElement = target, dy = 0) => {
      el.dispatchEvent(touch('touchstart', from, 300, 0));
      const move = touch('touchmove', from + (to - from) / 2, 300 + dy / 2, ms / 2);
      el.dispatchEvent(move);
      el.dispatchEvent(touch('touchmove', to, 300 + dy, ms));
      el.dispatchEvent(touch('touchend', to, 300 + dy, ms));
      return move;
    };
    return { history, arrow, swipe };
  }

  it('a swipe in from the left edge goes back, with the arrow following the finger', () => {
    const { history, arrow, swipe } = render();

    const move = swipe(5, 160, 600);

    expect(move.defaultPrevented).toBe(true);
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(arrow.style.top).toBe(`${300 - EdgeSwipeBackComponent.SIZE_PX / 2}px`);
  });

  it('arms the arrow past the threshold, and a short slow pull does not go back', () => {
    const { history, arrow, swipe } = render();
    target.dispatchEvent(touch('touchstart', 5, 300, 0));
    target.dispatchEvent(touch('touchmove', 140, 300, 300));
    expect(arrow.classList).toContain('is-armed');
    target.dispatchEvent(touch('touchmove', 60, 300, 600));
    expect(arrow.classList).not.toContain('is-armed');
    target.dispatchEvent(touch('touchend', 60, 300, 800));
    expect(history.back).not.toHaveBeenCalled();

    // A quick flick goes back without the full distance.
    swipe(5, 70, 60);
    expect(history.back).toHaveBeenCalledTimes(1);
  });

  it('leaves alone swipes away from the edge, scrolls, and places that opt out', () => {
    const { history, swipe } = render();

    swipe(120, 300, 400);
    // Mostly up/down: a scroll.
    const scroll = swipe(5, 60, 400, target, 200);
    expect(scroll.defaultPrevented).toBe(false);

    const photoViewer = document.createElement('div');
    photoViewer.setAttribute('data-no-swipe-back', '');
    const inside = document.createElement('img');
    photoViewer.appendChild(inside);
    target.appendChild(photoViewer);
    swipe(5, 200, 400, inside);

    const video = document.createElement('video');
    target.appendChild(video);
    swipe(5, 200, 400, video);

    expect(history.back).not.toHaveBeenCalled();
  });

  it('does nothing when there is nowhere to go back to', () => {
    const { history, swipe } = render(false);

    const move = swipe(5, 200, 400);

    expect(move.defaultPrevented).toBe(false);
    expect(history.back).not.toHaveBeenCalled();
  });
});
