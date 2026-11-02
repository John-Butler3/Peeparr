import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ScenePreviewAutoplayService } from '../scene-preview/scene-preview-autoplay.service';
import { ScenePreviewDirective } from '../scene-preview/scene-preview.directive';
import { PlayerService } from '../../core/player/player.service';
import { InlinePlayerComponent } from './inline-player.component';

@Component({
  imports: [ScenePreviewDirective],
  template: '<div [appScenePreview]="loader"></div>',
})
class CardThumbnail {
  readonly loader = () => of({ clipUrl: '/card-clip', streamUrl: '/card-stream', duration: 100 });
}

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
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
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

  it("fills the thumbnail with the site's logo a few seconds in, then starts the preview", () => {
    const { fixture, host } = render();
    fixture.componentRef.setInput('siteLogoUrl', '/logo.png');
    fixture.detectChanges();
    const poster = host.querySelector('.poster') as HTMLElement;
    host.querySelector('.poster-site img')!.dispatchEvent(new Event('load'));
    fixture.detectChanges();
    const play = vi.mocked(HTMLMediaElement.prototype.play);

    vi.advanceTimersByTime(InlinePlayerComponent.SITE_LOGO_AFTER_MS - 500);
    fixture.detectChanges();
    expect(poster.classList).not.toContain('is-showing-site');

    vi.advanceTimersByTime(700);
    fixture.detectChanges();
    expect(poster.classList).toContain('is-showing-site');
    const video = preview(host)!;
    expect(video.style.transitionDuration).toBe('500ms');
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(play).not.toHaveBeenCalled();

    vi.advanceTimersByTime(
      InlinePlayerComponent.PREVIEW_AFTER_LOGO_MS - InlinePlayerComponent.SITE_LOGO_AFTER_MS + 200,
    );
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(play).toHaveBeenCalled();

    // Never comes: the logo doesn't stay for good.
    vi.advanceTimersByTime(InlinePlayerComponent.SITE_LOGO_UNTIL_MS);
    fixture.detectChanges();
    expect(poster.classList).not.toContain('is-showing-site');
  });

  it('plays through once, fades back to the thumbnail and stays there', () => {
    const { fixture, host } = render();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS + 500);
    const video = preview(host)!;
    expect(video.loop).toBe(false);
    video.dispatchEvent(new Event('playing'));
    expect(video.classList).toContain('is-playing');

    video.dispatchEvent(new Event('ended'));
    fixture.detectChanges();
    expect(video.classList).not.toContain('is-playing');
    expect(video.style.transitionDuration).toBe('1200ms');

    play.mockClear();
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS * 3);
    expect(preview(host)).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("skips a site's logo that hasn't loaded, with a slow fade from the thumbnail", () => {
    const { fixture, host } = render();
    fixture.componentRef.setInput('siteLogoUrl', '/logo.png');
    fixture.detectChanges();

    vi.advanceTimersByTime(InlinePlayerComponent.SITE_LOGO_AFTER_MS + 500);
    fixture.detectChanges();
    expect(host.querySelector('.poster')?.classList).not.toContain('is-showing-site');
    expect(preview(host)?.style.transitionDuration).toBe('1400ms');
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

  it('lets the rows below preview once the page is scrolled, though the player stays pinned', () => {
    const { host } = render();
    const release = vi.spyOn(TestBed.inject(ScenePreviewAutoplayService), 'releaseHold');
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS + 500);
    expect(preview(host)).not.toBeNull();

    // Pinned: still on screen (getBoundingClientRect unchanged).
    Object.defineProperty(window, 'scrollY', { value: 600, configurable: true });
    vi.advanceTimersByTime(400);

    expect(release).toHaveBeenCalledWith(host);
    expect(preview(host)).toBeNull();
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS * 2);
    expect(preview(host)).toBeNull();
  });

  it('lets the rows below preview once its own has played through', () => {
    const { host } = render();
    const release = vi.spyOn(TestBed.inject(ScenePreviewAutoplayService), 'releaseHold');
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS + 500);

    preview(host)!.dispatchEvent(new Event('ended'));

    expect(release).toHaveBeenCalledWith(host);
  });

  it("doesn't cut off a card's preview that's already playing", () => {
    const { host } = render();
    const card = TestBed.createComponent(CardThumbnail);
    card.detectChanges();
    // (TestBed clears earlier fixtures out of the page when creating another.)
    document.body.appendChild(host);
    const cardPreview = card.debugElement
      .query(By.directive(ScenePreviewDirective))
      .injector.get(ScenePreviewDirective);

    cardPreview.playNow();
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS * 2);

    expect(cardPreview.isActive).toBe(true);
    expect(preview(host)).toBeNull();

    // Done: the thumbnail's turn, after its wait.
    cardPreview.stop();
    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS + 500);
    expect(preview(host)).not.toBeNull();
  });

  it('previews nothing for a scene that cannot be played', () => {
    const { fixture, host } = render();
    fixture.componentRef.setInput('playable', false);
    fixture.detectChanges();

    vi.advanceTimersByTime(InlinePlayerComponent.PREVIEW_AFTER_MS * 2);
    expect(preview(host)).toBeNull();
  });
});
