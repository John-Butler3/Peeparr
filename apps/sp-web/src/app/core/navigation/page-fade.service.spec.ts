import { TestBed } from '@angular/core/testing';
import { RouteReuseStrategy } from '@angular/router';
import { KeepAliveRouteStrategy } from './keep-alive-route.strategy';
import { NavigationHistoryService } from './navigation-history.service';
import { PageFadeService, onShowingPage } from './page-fade.service';

describe('PageFadeService', () => {
  let service: PageFadeService;
  let area: HTMLElement;
  let page: HTMLElement;
  let animation: { finished: Promise<void>; cancel: ReturnType<typeof vi.fn> };
  let finish: () => void;

  beforeEach(() => {
    service = TestBed.inject(PageFadeService);
    area = document.createElement('div');
    area.appendChild(document.createElement('router-outlet'));
    page = document.createElement('section');
    area.appendChild(page);
    animation = {
      finished: new Promise<void>((resolve) => (finish = resolve)),
      cancel: vi.fn(),
    };
    page.animate = vi.fn(() => animation as unknown as Animation);
    service.setArea(area);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('fades the page on screen out, resolving once faded, and the next one in gently', async () => {
    let done = false;
    const fading = service.fadeOut().then(() => (done = true));

    expect(page.animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], {
      duration: PageFadeService.FADE_OUT_MS,
      easing: 'ease-out',
      fill: 'forwards',
    });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await fading;
    expect(done).toBe(true);

    expect(service.takeSoftEnter()).toBe(true);
    // Asked once.
    expect(service.takeSoftEnter()).toBe(false);
  });

  it('shows the page again when the page change is cancelled', () => {
    void service.fadeOut();
    service.cancel();
    expect(animation.cancel).toHaveBeenCalled();
    expect(service.takeSoftEnter()).toBe(false);
  });

  it('resolves at once with no page to fade', async () => {
    service.setArea(null);
    await expect(service.fadeOut()).resolves.toBeUndefined();
  });

  describe('the page you came from, behind this one', () => {
    let home: HTMLElement;
    let retrieved: HTMLElement | null;

    beforeEach(() => {
      TestBed.resetTestingModule();
      home = document.createElement('main');
      retrieved = null;
      TestBed.configureTestingModule({
        providers: [
          {
            provide: RouteReuseStrategy,
            useValue: Object.assign(Object.create(KeepAliveRouteStrategy.prototype), {
              peekPage: (url: string) => (url === '/home' ? home : null),
              wasJustRetrieved: (element: HTMLElement) => element === retrieved,
            }),
          },
          { provide: NavigationHistoryService, useValue: { previous: () => ({ url: '/home' }) } },
        ],
      });
      service = TestBed.inject(PageFadeService);
      service.setArea(area);
      document.body.appendChild(area);
    });

    afterEach(() => area.remove());

    it('is readied ahead of time, unseen and asleep; a swipe only shows it', () => {
      expect(service.prepareBehind()).toBe(true);
      expect(home.parentElement).toBe(area);
      expect(home.style.opacity).toBe('0');
      expect(onShowingPage(home)).toBe(false);
      expect(page.style.zIndex).toBe('');

      // A swipe: shown (the same element), this page in front of it.
      expect(service.revealBehind()).toBe(true);
      expect(home.style.opacity).toBe('');
      expect(page.style.zIndex).toBe('1');

      // Let go short: unseen again, still there for the next swipe.
      service.cancel();
      expect(home.parentElement).toBe(area);
      expect(home.style.opacity).toBe('0');
      expect(page.style.zIndex).toBe('');
    });

    it('becomes the page when it is gone back to; is put away when another is gone to', () => {
      service.prepareBehind();
      retrieved = home;
      expect(service.finishReveal()).toBe(true);
      expect(home.classList.contains('page-behind')).toBe(false);
      expect(home.style.opacity).toBe('');
      expect(onShowingPage(home)).toBe(true);

      home.remove();
      service.prepareBehind();
      retrieved = null;
      expect(service.finishReveal()).toBe(false);
      expect(home.isConnected).toBe(false);
    });
  });
});
