import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PlayerService } from '../../core/player/player.service';
import { InlinePlayerComponent } from './inline-player.component';

describe('InlinePlayerComponent thumbnail preview', () => {
  function render(onScreen = true) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PlayerService, useValue: { close: vi.fn(), saveProgress: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(InlinePlayerComponent);
    fixture.componentRef.setInput('title', 'Scene');
    fixture.componentRef.setInput('localSceneId', '412');
    document.body.appendChild(fixture.nativeElement);
    const host = fixture.nativeElement as HTMLElement;
    const place = (top: number) =>
      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
        top,
        bottom: top + 180,
        left: 0,
        right: 320,
        width: 320,
        height: 180,
      } as DOMRect);
    place(onScreen ? 0 : 5000);
    fixture.detectChanges();
    return { fixture, host, place };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const preview = (host: HTMLElement) =>
    host.querySelector<HTMLVideoElement>('video.hover-preview');

  it('loads the preview ahead, and only plays it once the thumbnail has been on screen a few seconds', () => {
    const { host } = render();
    const play = vi.mocked(HTMLMediaElement.prototype.play);

    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS - 500);
    const video = preview(host)!;
    expect(video.getAttribute('src')).toBe('/api/media/stash/scenes/412/preview');
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(play).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(play).toHaveBeenCalled();
  });

  it("shows the site's logo before the preview, loading it hidden meanwhile, with a slow fade", () => {
    const { fixture, host } = render();
    fixture.componentRef.setInput('siteLogoUrl', '/logo.png');
    fixture.detectChanges();
    const poster = host.querySelector('.poster') as HTMLElement;

    vi.advanceTimersByTime(InlinePlayerComponent.SITE_LOGO_AFTER_MS + 200);
    fixture.detectChanges();
    expect(poster.classList).toContain('is-showing-site');
    expect(host.querySelector('.poster-site img')?.getAttribute('src')).toBe('/logo.png');
    const video = preview(host);
    expect(video?.classList).not.toContain('is-playing');
    expect(video?.style.transitionDuration).toBe('1400ms');

    // Never comes: the logo doesn't stay for good.
    vi.advanceTimersByTime(InlinePlayerComponent.SITE_LOGO_UNTIL_MS);
    fixture.detectChanges();
    expect(poster.classList).not.toContain('is-showing-site');
  });

  it('waits while the thumbnail is off screen, and stops when it is scrolled away', () => {
    const { host, place } = render(false);

    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS * 2);
    expect(preview(host)).toBeNull();

    place(0);
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS + 500);
    expect(preview(host)).not.toBeNull();

    place(5000);
    vi.advanceTimersByTime(1000);
    expect(preview(host)).toBeNull();
  });

  it('previews nothing for a scene that cannot be played', () => {
    const { fixture, host } = render();
    fixture.componentRef.setInput('playable', false);
    fixture.detectChanges();

    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS * 2);
    expect(preview(host)).toBeNull();
  });
});
