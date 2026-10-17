import { TestBed } from '@angular/core/testing';
import { PageFadeService } from './page-fade.service';

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
});
