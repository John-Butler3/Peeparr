import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SceneRequestContext } from '../../core/api/discover.types';
import { SceneCardComponent, SceneCardItem } from './scene-card.component';
import { ScenePreviewAutoplayService } from '../scene-preview/scene-preview-autoplay.service';

function buildSceneCardItem(overrides: Partial<SceneCardItem> = {}): SceneCardItem {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    imageUrl: 'http://cdn.local/image.jpg',
    cardImageUrl: 'http://cdn.local/card.jpg',
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-28',
    status: { state: 'NOT_REQUESTED' },
    ...overrides,
  };
}

describe('SceneCardComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderCard() {
    await TestBed.configureTestingModule({
      imports: [SceneCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(SceneCardComponent);

    return { fixture, component: fixture.componentInstance };
  }

  it('renders the canonical discovery card with an internal scene link, studio page badge, and request event', async () => {
    const { fixture, component } = await renderCard();
    const emitted: SceneRequestContext[] = [];
    component.item = buildSceneCardItem();
    component.requestable = true;
    component.sceneQueryParams = { returnTo: '/scenes' };
    component.request.subscribe((item) => emitted.push(item));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const studioBadgeLink = fixture.nativeElement.querySelector(
      '.studio-badge-link',
    ) as HTMLAnchorElement | null;
    const requestButton = fixture.nativeElement.querySelector(
      '.request-action',
    ) as HTMLButtonElement | null;

    expect(sceneLink?.getAttribute('href')).toContain('/scene/scene-1');
    expect(sceneLink?.getAttribute('href')).toContain('returnTo=%2Fscenes');
    expect(studioBadgeLink?.getAttribute('href')).toContain('/studio/studio-1');
    expect(requestButton?.getAttribute('aria-label')).toBe('Request');

    requestButton?.click();

    expect(emitted).toEqual([
      {
        id: 'scene-1',
        title: 'Scene Title',
        imageUrl: 'http://cdn.local/image.jpg',
      },
    ]);
  });

  it('renders no studio badge link when the item has no studioId', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({ studioId: null });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const studioBadgeLink = fixture.nativeElement.querySelector('.studio-badge-link');
    expect(studioBadgeLink).toBeNull();
  });

  it('suppresses the studio badge entirely when showStudioBadge is false', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem();
    component.showStudioBadge = false;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.studio-badge')).toBeNull();
    expect(fixture.nativeElement.querySelector('.studio-badge-link')).toBeNull();
  });

  it('renders status-driven external cards without the request CTA', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({
      status: { state: 'AVAILABLE' },
      studioImageUrl: null,
    });
    component.requestable = false;
    component.variant = 'rail';
    component.primaryLinkMode = 'external';
    component.externalHref = 'http://stash.local/scenes/scene-1';

    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const requestButton = fixture.nativeElement.querySelector('.request-action');
    const footerStatusBadge = fixture.nativeElement.querySelector('.footer-status-badge');
    const statusIcon = fixture.nativeElement.querySelector('.status-icon');
    const host = fixture.nativeElement as HTMLElement;

    expect(host.classList.contains('scene-card-variant-rail')).toBe(true);
    expect(sceneLink?.getAttribute('href')).toBe('http://stash.local/scenes/scene-1');
    expect(requestButton).toBeNull();
    expect(footerStatusBadge).toBeTruthy();
    expect(statusIcon).toBeTruthy();
  });

  it('shows a play CTA instead of the status badge for playable available scenes', async () => {
    const { fixture, component } = await renderCard();
    const emitted: string[] = [];
    component.item = buildSceneCardItem({ status: { state: 'AVAILABLE' } });
    component.requestable = false;
    component.playable = true;
    component.play.subscribe((id) => emitted.push(id));

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector(
      '.play-action',
    ) as HTMLButtonElement | null;
    const footerStatusBadge = fixture.nativeElement.querySelector('.footer-status-badge');

    expect(playButton?.getAttribute('aria-label')).toBe('Play');
    expect(footerStatusBadge).toBeNull();

    playButton?.click();

    expect(emitted).toEqual(['scene-1']);
  });

  // YouTube cards: playSize 'large' still renders the footer Play
  // pill -- there's no button over the thumbnail.
  it('plays from the Play pill without navigating, leaving the card link to scene info', async () => {
    const { fixture, component } = await renderCard();
    const emitted: string[] = [];
    component.item = buildSceneCardItem({ status: { state: 'AVAILABLE' } });
    component.requestable = false;
    component.playable = true;
    component.playSize = 'large';
    component.play.subscribe((id) => emitted.push(id));

    fixture.detectChanges();

    const cardLink = fixture.nativeElement.querySelector(
      'a.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const playButton = fixture.nativeElement.querySelector(
      '.play-center-button',
    ) as HTMLButtonElement | null;
    const compactButton = fixture.nativeElement.querySelector('.play-action');

    expect(cardLink?.getAttribute('href')).toContain('/scene/scene-1');
    expect(playButton).toBeNull();
    expect(compactButton).toBeTruthy();

    (compactButton as HTMLButtonElement).click();

    expect(emitted).toEqual(['scene-1']);
  });

  it('shows the request status in the title button instead of Play for non-available scenes', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({ status: { state: 'DOWNLOADING' } });
    component.requestable = false;
    component.playable = true;

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector('.play-action');
    const statusButton = fixture.nativeElement.querySelector('.status-action');

    expect(playButton).toBeNull();
    expect(fixture.nativeElement.querySelector('.footer-status-badge')).toBeNull();
    expect(statusButton?.getAttribute('data-tone')).toBe('downloading');
    expect(statusButton?.querySelector('.pi-arrow-down')).toBeTruthy();
  });

  it('supports compact library cards with a scene-details primary link and stash footer action', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({
      id: 'local-scene-411',
      status: null,
    });
    component.primaryLinkMode = 'scene';
    component.sceneRouteId = 'catalog-scene-411';
    component.sceneQueryParams = { returnTo: '/library' };
    component.topBadges = [{ label: 'Local' }];
    component.footerLinkLabel = 'View in Stash';
    component.footerLink = {
      kind: 'external',
      href: 'http://stash.local/scenes/411',
      ariaLabel: 'View Scene Title in Stash',
    };

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const studioBadgeLink = fixture.nativeElement.querySelector(
      '.studio-badge-link',
    ) as HTMLAnchorElement | null;
    const topBadge = fixture.nativeElement.querySelector('.top-badge') as HTMLElement | null;
    const footerLink = fixture.nativeElement.querySelector(
      '.footer-link',
    ) as HTMLAnchorElement | null;

    expect(sceneLink?.getAttribute('href')).toContain('/scene/catalog-scene-411');
    expect(sceneLink?.getAttribute('href')).toContain('returnTo=%2Flibrary');
    expect(studioBadgeLink?.getAttribute('href')).toContain('/studio/studio-1');
    expect(topBadge?.textContent?.trim()).toBe('Local');
    expect(footerLink?.getAttribute('href')).toBe('http://stash.local/scenes/411');
  });

  it('renders a compact footer badge for local-only library cards', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({
      id: 'local-only-512',
      status: null,
      studioImageUrl: null,
    });
    component.primaryLinkMode = 'external';
    component.externalHref = 'http://stash.local/scenes/512';
    component.topBadges = [{ label: 'Local' }];
    component.footerBadgeLabel = 'Local only';

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sceneLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const footerBadge = fixture.nativeElement.querySelector('.footer-pill') as HTMLElement | null;
    const footerStatusBadge = fixture.nativeElement.querySelector('.footer-status-badge');

    expect(sceneLink?.getAttribute('href')).toBe('http://stash.local/scenes/512');
    expect(footerBadge?.textContent?.trim()).toBe('Local only');
    expect(footerStatusBadge).toBeNull();
  });

  it('shows a compact play icon alongside the stash footer link for playable library cards', async () => {
    const { fixture, component } = await renderCard();
    const emitted: string[] = [];
    component.item = buildSceneCardItem({ id: 'local-scene-411', status: null });
    component.footerLinkLabel = 'View in Stash';
    component.footerLink = {
      kind: 'external',
      href: 'http://stash.local/scenes/411',
      ariaLabel: 'View Scene Title in Stash',
    };
    component.playable = true;
    component.play.subscribe((id) => emitted.push(id));

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector(
      '.play-action',
    ) as HTMLButtonElement | null;
    const footerLink = fixture.nativeElement.querySelector('.footer-link');

    expect(playButton).toBeTruthy();
    // Play is an icon button beside the title.
    expect(playButton?.closest('.title-row')).toBeTruthy();
    expect(footerLink).toBeTruthy();

    playButton?.click();

    expect(emitted).toEqual(['local-scene-411']);
  });

  it('shows a compact play icon alongside the local-only badge for playable library cards', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({ id: 'local-only-512', status: null });
    component.footerBadgeLabel = 'Local only';
    component.playable = true;

    fixture.detectChanges();

    const playButton = fixture.nativeElement.querySelector(
      '.play-action',
    ) as HTMLButtonElement | null;
    const footerBadge = fixture.nativeElement.querySelector('.footer-pill');

    expect(playButton).toBeTruthy();
    // Play is an icon button beside the title.
    expect(playButton?.closest('.title-row')).toBeTruthy();
    expect(footerBadge?.textContent?.trim()).toBe('Local only');
  });
  it('opens the scene from anywhere in the text under the thumbnail', async () => {
    const { fixture, component } = await renderCard();
    component.item = buildSceneCardItem({ status: { state: 'AVAILABLE' } });
    fixture.detectChanges();

    const stretch = fixture.nativeElement.querySelector('.details-link-stretch') as HTMLAnchorElement;
    expect(stretch.getAttribute('href')).toBe('/scene/scene-1');
    expect(stretch.getAttribute('tabindex')).toBe('-1');
  });

  describe('hover preview', () => {
    function pointer(type: string, pointerType: string): Event {
      const event = new MouseEvent(type);
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      return event;
    }

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('plays the middle of a library scene after resting the mouse on it, and stops on leave', async () => {
      const { fixture, component } = await renderCard();
      component.item = buildSceneCardItem({ id: '412', status: null, duration: 600 });
      component.playable = true;
      component.previewKind = 'local';
      fixture.detectChanges();
      const media = fixture.nativeElement.querySelector('.media') as HTMLElement;

      media.dispatchEvent(pointer('pointerenter', 'mouse'));
      vi.advanceTimersByTime(50);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('video')).toBeNull();

      // Starts loading early, hidden until the hover is confirmed.
      vi.advanceTimersByTime(100);
      fixture.detectChanges();
      const video = fixture.nativeElement.querySelector('video.hover-preview') as HTMLVideoElement;
      expect(video.getAttribute('src')).toBe('/api/media/stash/scenes/412/preview');
      expect(video.muted).toBe(true);
      video.dispatchEvent(new Event('playing'));
      fixture.detectChanges();
      expect(video.classList.contains('is-playing')).toBe(false);

      vi.advanceTimersByTime(400);
      fixture.detectChanges();
      expect(video.classList.contains('is-playing')).toBe(true);
      expect(media.classList.contains('is-previewing')).toBe(true);

      media.dispatchEvent(pointer('pointerleave', 'mouse'));
      vi.advanceTimersByTime(500);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('video')).toBeNull();
      expect(media.classList.contains('is-previewing')).toBe(false);
    });

    it('fades the preview in once it plays and back out to the thumbnail on leave', async () => {
      const { fixture, component } = await renderCard();
      component.item = buildSceneCardItem({ id: '412', status: null, duration: 600 });
      component.playable = true;
      component.previewKind = 'local';
      fixture.detectChanges();
      const media = fixture.nativeElement.querySelector('.media') as HTMLElement;

      media.dispatchEvent(pointer('pointerenter', 'mouse'));
      vi.advanceTimersByTime(600);
      fixture.detectChanges();
      const video = fixture.nativeElement.querySelector('video.hover-preview') as HTMLVideoElement;
      expect(video.classList.contains('is-playing')).toBe(false);

      video.dispatchEvent(new Event('playing'));
      fixture.detectChanges();
      expect(video.classList.contains('is-playing')).toBe(true);

      media.dispatchEvent(pointer('pointerleave', 'mouse'));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('video.hover-preview')).toBe(video);
      expect(video.classList.contains('is-playing')).toBe(false);

      vi.advanceTimersByTime(500);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('video')).toBeNull();
    });

    it("falls back to the full file's middle when Stash has no preview clip", async () => {
      const { fixture, component } = await renderCard();
      component.item = buildSceneCardItem({ id: '977', status: null, duration: 600 });
      component.playable = true;
      component.previewKind = 'local';
      fixture.detectChanges();
      const media = fixture.nativeElement.querySelector('.media') as HTMLElement;

      media.dispatchEvent(pointer('pointerenter', 'mouse'));
      vi.advanceTimersByTime(150);
      const clip = media.querySelector('video.hover-preview') as HTMLVideoElement;
      expect(clip.getAttribute('src')).toBe('/api/media/stash/scenes/977/preview');
      expect(clip.loop).toBe(true);

      clip.dispatchEvent(new Event('error'));
      const full = media.querySelector('video.hover-preview') as HTMLVideoElement;
      expect(full.getAttribute('src')).toBe('/api/media/stash/scenes/977/stream#t=300');
      expect(full.loop).toBe(false);

      // Remembered: next time it goes straight to the full file.
      media.dispatchEvent(pointer('pointerleave', 'mouse'));
      vi.advanceTimersByTime(500);
      media.dispatchEvent(pointer('pointerenter', 'mouse'));
      vi.advanceTimersByTime(150);
      expect(media.querySelector('video.hover-preview')?.getAttribute('src')).toBe(
        '/api/media/stash/scenes/977/stream#t=300',
      );
    });

    it("doesn't start a hover preview while the page is scrolling under the mouse", async () => {
      const { fixture, component } = await renderCard();
      component.item = buildSceneCardItem({ id: '412', status: null, duration: 600 });
      component.playable = true;
      component.previewKind = 'local';
      fixture.detectChanges();
      const media = fixture.nativeElement.querySelector('.media') as HTMLElement;

      // The card slides under a resting mouse mid-scroll.
      document.dispatchEvent(new Event('scroll'));
      media.dispatchEvent(pointer('pointerenter', 'mouse'));
      vi.advanceTimersByTime(100);
      document.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(140);
      expect(media.querySelector('video')).toBeNull();

      // Page has stopped: it starts.
      vi.advanceTimersByTime(300);
      expect(media.querySelector('video.hover-preview')).not.toBeNull();
    });

    it('does not preview on touch', async () => {
      const { fixture, component } = await renderCard();
      component.item = buildSceneCardItem({ id: '412', status: null, duration: 600 });
      component.playable = true;
      component.previewKind = 'local';
      fixture.detectChanges();
      const media = fixture.nativeElement.querySelector('.media') as HTMLElement;

      media.dispatchEvent(pointer('pointerenter', 'touch'));
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('video')).toBeNull();
    });

    it('on a touch screen, plays the card in view once scrolling stops, without any gesture', async () => {
      const { fixture, component } = await renderCard();
      TestBed.inject(ScenePreviewAutoplayService).touchScreen = true;
      component.item = buildSceneCardItem({ id: '412', status: null, duration: 600 });
      component.playable = true;
      component.previewKind = 'local';
      fixture.detectChanges();
      const media = fixture.nativeElement.querySelector('.media') as HTMLElement;
      // In the middle of a 1024x768 viewport.
      media.getBoundingClientRect = () =>
        ({ top: 284, bottom: 484, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;

      document.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(50);
      expect(media.querySelector('video')).toBeNull();

      vi.advanceTimersByTime(60);
      const video = media.querySelector('video.hover-preview') as HTMLVideoElement;
      expect(video.getAttribute('src')).toBe('/api/media/stash/scenes/412/preview');
      video.dispatchEvent(new Event('playing'));
      expect(video.classList.contains('is-playing')).toBe(true);
    });

    it('does not preview scenes that cannot be played', async () => {
      const { fixture, component } = await renderCard();
      component.item = buildSceneCardItem({ status: { state: 'NOT_REQUESTED' } });
      component.playable = true;
      component.previewKind = 'catalog';
      fixture.detectChanges();
      const media = fixture.nativeElement.querySelector('.media') as HTMLElement;

      media.dispatchEvent(pointer('pointerenter', 'mouse'));
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('video')).toBeNull();
    });
  });
});
