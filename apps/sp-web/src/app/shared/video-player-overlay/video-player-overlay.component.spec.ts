import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlayerQueue, PlayerService, PlayerState } from '../../core/player/player.service';
import { VideoPlayerOverlayComponent } from './video-player-overlay.component';

describe('VideoPlayerOverlayComponent', () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let mediaSessionStub: {
    metadata: unknown;
    playbackState: string;
    setActionHandler: ReturnType<typeof vi.fn>;
  };
  let originalMediaSession: PropertyDescriptor | undefined;
  let originalMediaMetadata: typeof globalThis.MediaMetadata | undefined;

  beforeEach(() => {
    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    // jsdom implements neither the Media Session API nor MediaMetadata --
    // stub both so the component's real code path (not just the feature
    // guard) is actually exercised.
    mediaSessionStub = { metadata: null, playbackState: 'none', setActionHandler: vi.fn() };
    originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
    Object.defineProperty(navigator, 'mediaSession', {
      value: mediaSessionStub,
      configurable: true,
    });
    originalMediaMetadata = globalThis.MediaMetadata;
    globalThis.MediaMetadata = class {
      title?: string;
      artwork?: unknown;
      constructor(init: { title?: string; artwork?: unknown }) {
        this.title = init.title;
        this.artwork = init.artwork;
      }
    } as unknown as typeof globalThis.MediaMetadata;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    if (originalMediaSession) {
      Object.defineProperty(navigator, 'mediaSession', originalMediaSession);
    } else {
      delete (navigator as { mediaSession?: unknown }).mediaSession;
    }
    globalThis.MediaMetadata = originalMediaMetadata as typeof globalThis.MediaMetadata;
  });

  async function renderOverlay(
    initialState: PlayerState | null = null,
    initialQueue: PlayerQueue | null = null,
  ) {
    const state = signal<PlayerState | null>(initialState);
    const queue = signal<PlayerQueue | null>(initialQueue);
    const mode = signal<'full' | 'mini'>('full');
    const playerService = {
      state,
      queue,
      hasNext: computed(() => {
        const q = queue();
        return !!q && q.index < q.items.length - 1;
      }),
      hasPrevious: computed(() => (queue()?.index ?? 0) > 0),
      details: signal(null),
      mode,
      minimize: vi.fn(() => mode.set('mini')),
      expand: vi.fn(() => mode.set('full')),
      playQueueIndex: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
      close: vi.fn(),
      saveProgress: vi.fn(),
      openByCatalogSceneId: vi.fn(),
      openByLocalSceneId: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [VideoPlayerOverlayComponent],
      providers: [{ provide: PlayerService, useValue: playerService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(VideoPlayerOverlayComponent);
    fixture.detectChanges();

    return { fixture, playerService, state };
  }

  it('renders nothing when no scene is open', async () => {
    const { fixture } = await renderOverlay(null);

    expect(fixture.nativeElement.querySelector('.watch')).toBeNull();
  });

  it('shows a loading spinner with the scene title while resolving', async () => {
    const { fixture } = await renderOverlay({
      status: 'loading',
      title: 'A Scene',
      imageUrl: null,
    });

    expect(fixture.nativeElement.textContent).toContain('A Scene');
    expect(fixture.nativeElement.textContent).toContain('Loading stream');
    expect(fixture.nativeElement.querySelector('video')).toBeNull();
  });

  it('shows the error message when the source failed to load', async () => {
    const { fixture } = await renderOverlay({
      status: 'error',
      title: 'A Scene',
      imageUrl: null,
      message: 'Failed to load stream from Stash.',
    });

    expect(fixture.nativeElement.textContent).toContain('Failed to load stream from Stash.');
  });

  it('renders the video element with the resolved stream once ready', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 30,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video?.src).toBe('http://stash.local/stream');
  });

  it('seeks to the saved resume position once the video metadata loads', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 30,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });

    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.currentTime).toBe(30);
    expect(playSpy).toHaveBeenCalled();
  });

  it('sets the OS/browser now-playing info to the scene title and thumbnail once metadata loads', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    const metadata = mediaSessionStub.metadata as {
      title: string;
      artwork: Array<{ src: string; sizes: string }>;
    };
    expect(metadata.title).toBe('A Scene');
    expect(metadata.artwork.length).toBeGreaterThan(1);
    expect(metadata.artwork.every((entry) => entry.src === 'http://cdn.local/a-scene.jpg')).toBe(
      true,
    );
    expect(new Set(metadata.artwork.map((entry) => entry.sizes)).size).toBe(
      metadata.artwork.length,
    );
    expect(mediaSessionStub.playbackState).toBe('playing');
  });

  it('registers play/pause/seek action handlers once metadata loads', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    const registeredActions = mediaSessionStub.setActionHandler.mock.calls
      .filter(([, handler]) => handler !== null)
      .map(([action]) => action);
    expect(registeredActions).toEqual(
      expect.arrayContaining(['play', 'pause', 'seekto', 'seekbackward', 'seekforward']),
    );
  });

  it('omits artwork when the scene has no thumbnail', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(mediaSessionStub.metadata).toMatchObject({ title: 'A Scene', artwork: [] });
  });

  it('reflects pause/resume in the OS playback state', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 5, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    video.dispatchEvent(new Event('pause'));
    expect(mediaSessionStub.playbackState).toBe('paused');

    video.dispatchEvent(new Event('play'));
    expect(mediaSessionStub.playbackState).toBe('playing');
  });

  it('clears the now-playing info when the player is closed', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(mediaSessionStub.metadata).not.toBeNull();

    const closeButton = fixture.nativeElement.querySelector(
      '[aria-label="Close player"]',
    ) as HTMLButtonElement;
    closeButton.click();

    expect(mediaSessionStub.metadata).toBeNull();
    expect(mediaSessionStub.playbackState).toBe('none');

    const clearedActions = mediaSessionStub.setActionHandler.mock.calls
      .filter(([, handler]) => handler === null)
      .map(([action]) => action);
    expect(clearedActions).toEqual(
      expect.arrayContaining(['play', 'pause', 'seekto', 'seekbackward', 'seekforward']),
    );
    expect(playerService.close).toHaveBeenCalled();
  });

  it('does not seek when there is no saved resume position', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });

    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.currentTime).toBe(0);
  });

  it('saves progress when the video is paused', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 42, configurable: true });

    video.dispatchEvent(new Event('pause'));

    expect(playerService.saveProgress).toHaveBeenCalledWith('411', 42, 600);
  });

  it('saves progress and closes the player when the close button is clicked', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: {
        streamUrl: 'http://stash.local/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: 600,
      },
    });

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 15, configurable: true });

    const closeButton = fixture.nativeElement.querySelector(
      '[aria-label="Close player"]',
    ) as HTMLButtonElement;
    closeButton.click();

    expect(playerService.saveProgress).toHaveBeenCalledWith('411', 15, 600);
    expect(playerService.close).toHaveBeenCalled();
  });

  it('minimizes to the miniplayer (Escape) and expands back, keeping the same video', async () => {
    const { fixture, playerService } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: { streamUrl: '/stream', stashSceneId: '411', resumeSeconds: 0, duration: 600 },
    });
    const element = fixture.nativeElement as HTMLElement;
    const video = element.querySelector('video');
    expect(element.querySelector('[aria-label="Minimize player"]')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(playerService.minimize).toHaveBeenCalled();
    expect(element.querySelector('.watch.is-mini')).toBeTruthy();
    expect(element.querySelector('video')).toBe(video);
    expect(playerService.close).not.toHaveBeenCalled();

    (element.querySelector('[aria-label="Expand player"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(element.querySelector('.watch.is-full')).toBeTruthy();
    expect(element.querySelector('video')).toBe(video);
  });

  it('draws a progress line along the miniplayer that follows playback', async () => {
    const { fixture } = await renderOverlay({
      status: 'ready',
      title: 'A Scene',
      imageUrl: null,
      source: { streamUrl: '/stream', stashSceneId: '411', resumeSeconds: 0, duration: 600 },
    });
    const element = fixture.nativeElement as HTMLElement;
    const video = element.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });

    expect(element.querySelector('.mini-progress')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    video.currentTime = 150;
    video.dispatchEvent(new Event('timeupdate'));
    fixture.detectChanges();

    const bar = element.querySelector('.mini-progress') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect((bar.querySelector('.mini-progress-fill') as HTMLElement).style.transform).toBe(
      'scaleX(0.25)',
    );
  });

  describe('series queue', () => {
    const readyState: PlayerState = {
      status: 'ready',
      title: 'Part Two',
      imageUrl: null,
      source: { streamUrl: '/api/media/stash/scenes/12/stream', stashSceneId: '12', resumeSeconds: 0, duration: 600 },
    };
    const queue: PlayerQueue = {
      name: 'Trilogy',
      items: [
        { localSceneId: '11', title: 'Part One', imageUrl: null },
        { localSceneId: '12', title: 'Part Two', imageUrl: null },
        { localSceneId: '13', title: 'Part Three', imageUrl: null },
      ],
      index: 1,
    };

    it('shows the series and part number with previous/next controls', async () => {
      const { fixture } = await renderOverlay(readyState, queue);
      const element = fixture.nativeElement as HTMLElement;

      expect(element.querySelector('[data-testid="player-queue-label"]')?.textContent).toContain(
        'Trilogy · Part 2 of 3',
      );
      expect(
        (element.querySelector('[aria-label="Previous part"]') as HTMLButtonElement).disabled,
      ).toBe(false);
      expect((element.querySelector('[aria-label="Next part"]') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it('moves on to the next part when one finishes', async () => {
      const { fixture, playerService } = await renderOverlay(readyState, queue);

      fixture.nativeElement.querySelector('video').dispatchEvent(new Event('ended'));

      expect(playerService.next).toHaveBeenCalledTimes(1);
    });

    it('saves progress before skipping ahead', async () => {
      const { fixture, playerService } = await renderOverlay(readyState, queue);

      (fixture.nativeElement.querySelector('[aria-label="Next part"]') as HTMLButtonElement).click();

      expect(playerService.saveProgress).toHaveBeenCalledWith('12', expect.any(Number), null);
      expect(playerService.next).toHaveBeenCalledTimes(1);
    });

    it('has no queue controls for a single scene', async () => {
      const { fixture } = await renderOverlay(readyState, null);

      expect(fixture.nativeElement.querySelector('[aria-label="Next part"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="player-queue-label"]')).toBeNull();
    });
  });
});
