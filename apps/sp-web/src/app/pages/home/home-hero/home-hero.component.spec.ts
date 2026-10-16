import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeRailItem } from '../../../core/api/home.types';
import { HomeHeroComponent } from './home-hero.component';

function buildItem(index: number): HomeRailItem {
  return {
    id: `local-scene-${index}`,
    activeCatalogSceneId: index === 1 ? 'catalog-scene-1' : null,
    title: `Recent Scene ${index}`,
    description: null,
    imageUrl: null,
    cardImageUrl: `/api/media/stash/scenes/local-scene-${index}/screenshot`,
    studioId: null,
    studio: 'Archive',
    studioImageUrl: null,
    releaseDate: '2026-10-01',
    duration: 1200,
    type: 'SCENE',
    source: 'STASH',
    status: { state: 'AVAILABLE' },
    requestable: false,
    viewUrl: null,
    progressPercent: null,
  };
}

function touch(type: string, x: number, y: number): Event {
  const event = new Event(type);
  Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
  return event;
}

describe('HomeHeroComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render(items: HomeRailItem[]) {
    await TestBed.configureTestingModule({
      imports: [HomeHeroComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(HomeHeroComponent);
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    vi.advanceTimersByTime(0);
    fixture.detectChanges();
    return fixture;
  }

  function title(fixture: { nativeElement: HTMLElement }): string | undefined {
    return fixture.nativeElement.querySelector('.hero-title')?.textContent?.trim();
  }

  it('shows only the five most recent scenes and links to the catalog page when known', async () => {
    const fixture = await render([1, 2, 3, 4, 5, 6, 7].map(buildItem));

    expect(fixture.nativeElement.querySelectorAll('.hero-slide').length).toBe(5);
    expect(fixture.nativeElement.querySelectorAll('.hero-dot').length).toBe(5);
    expect(title(fixture)).toBe('Recent Scene 1');
    expect(fixture.nativeElement.querySelector('.hero-tag')?.textContent).toContain(
      'New in your library',
    );
    expect(fixture.nativeElement.querySelector('.hero-meta')?.textContent).not.toContain(
      'Recently added',
    );
    expect(fixture.nativeElement.querySelector('.hero-slide').getAttribute('href')).toBe(
      '/scene/catalog-scene-1',
    );
    expect(fixture.nativeElement.querySelector('.hero-video').getAttribute('src')).toBe(
      '/api/media/stash/scenes/local-scene-1/preview',
    );
  });

  it('moves on after eight seconds of full-file preview, looping back to the first', async () => {
    const fixture = await render([1, 2].map(buildItem));
    const video: HTMLVideoElement = fixture.nativeElement.querySelector('.hero-video');

    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(7900);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 1');

    vi.advanceTimersByTime(100 + HomeHeroComponent.FADE_OUT_MS);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 2');

    vi.advanceTimersByTime(HomeHeroComponent.SLIDE_MS);
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(8000 + HomeHeroComponent.FADE_OUT_MS);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 1');
  });

  it('fills the progress bar over the preview time, without restarting after buffering', async () => {
    const fixture = await render([1, 2].map(buildItem));
    const video: HTMLVideoElement = fixture.nativeElement.querySelector('.hero-video');
    const fill = () =>
      fixture.nativeElement.querySelector('.hero-progress-fill') as HTMLElement | null;
    expect(fill()).toBeNull();

    video.dispatchEvent(new Event('playing'));
    fixture.detectChanges();
    const first = fill();
    expect(first?.style.animationDuration).toBe('8000ms');

    vi.advanceTimersByTime(5000);
    video.dispatchEvent(new Event('playing'));
    fixture.detectChanges();
    expect(fill()).toBe(first);

    vi.advanceTimersByTime(3000);
    fixture.detectChanges();
    // The bar goes as the preview starts fading out.
    expect(fill()).toBeNull();
    vi.advanceTimersByTime(HomeHeroComponent.FADE_OUT_MS);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 2');
  });

  it("moves on when Stash's preview clip has played through once", async () => {
    const fixture = await render([1, 2].map(buildItem));
    const video: HTMLVideoElement = fixture.nativeElement.querySelector('.hero-video');
    Object.defineProperty(video, 'duration', { value: 9.2, configurable: true });

    video.dispatchEvent(new Event('playing'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hero-progress-fill').style.animationDuration).toBe(
      '9200ms',
    );
    vi.advanceTimersByTime(9100);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 1');
    vi.advanceTimersByTime(100 + HomeHeroComponent.FADE_OUT_MS);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 2');
  });

  it('at the end of a preview: fades back to the picture, slides on, then fades into the next preview', async () => {
    const fixture = await render([1, 2].map(buildItem));
    const video: HTMLVideoElement = fixture.nativeElement.querySelector('.hero-video');
    const track: HTMLElement = fixture.nativeElement.querySelector('.hero-track');
    video.dispatchEvent(new Event('playing'));
    fixture.detectChanges();
    expect(video.classList).toContain('is-playing');
    const firstSource = video.getAttribute('src');

    // 1. Fading out: same scene, the preview still there underneath.
    vi.advanceTimersByTime(8000);
    fixture.detectChanges();
    expect(video.classList).not.toContain('is-playing');
    expect(video.getAttribute('src')).toBe(firstSource);
    expect(track.style.transform).toContain('calc(0%');

    // 2. Faded: slides to the next picture, no preview loading meanwhile.
    vi.advanceTimersByTime(HomeHeroComponent.FADE_OUT_MS);
    fixture.detectChanges();
    expect(track.style.transform).toContain('-100%');
    expect(video.getAttribute('src')).toBeNull();

    // 3. Slid: the next preview loads, and fades in once it plays.
    vi.advanceTimersByTime(HomeHeroComponent.SLIDE_MS);
    fixture.detectChanges();
    expect(video.getAttribute('src')).toContain('local-scene-2');
    video.dispatchEvent(new Event('playing'));
    fixture.detectChanges();
    expect(video.classList).toContain('is-playing');
  });

  it('moves on anyway when a preview never starts, and dots jump to a scene', async () => {
    const fixture = await render([1, 2, 3].map(buildItem));

    vi.advanceTimersByTime(12000);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 2');

    fixture.nativeElement.querySelectorAll('.hero-dot')[2].click();
    fixture.detectChanges();
    expect(title(fixture)).toBe('Recent Scene 3');
  });

  it('swipes sideways between scenes, but not on short or vertical moves', async () => {
    const fixture = await render([1, 2, 3].map(buildItem));
    const stage: HTMLElement = fixture.nativeElement.querySelector('.hero-stage');
    const swipe = (dx: number, dy = 0) => {
      stage.dispatchEvent(touch('touchstart', 200, 100));
      stage.dispatchEvent(touch('touchmove', 200 + dx, 100 + dy));
      stage.dispatchEvent(new Event('touchend'));
      fixture.detectChanges();
    };

    swipe(-120);
    expect(title(fixture)).toBe('Recent Scene 2');
    swipe(120);
    expect(title(fixture)).toBe('Recent Scene 1');
    swipe(120);
    expect(title(fixture)).toBe('Recent Scene 3');
    swipe(-20);
    expect(title(fixture)).toBe('Recent Scene 3');
    swipe(-60, 150);
    expect(title(fixture)).toBe('Recent Scene 3');
  });

  it('emits play for the current scene', async () => {
    const fixture = await render([1, 2].map(buildItem));
    const played: string[] = [];
    fixture.componentInstance.play.subscribe((id) => played.push(id));

    fixture.nativeElement.querySelector('.hero-play').click();

    expect(played).toEqual(['local-scene-1']);
  });
});
