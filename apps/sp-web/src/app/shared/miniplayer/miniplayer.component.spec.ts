import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MiniplayerState, PlayerDetails, PlayerService } from '../../core/player/player.service';
import { MiniplayerComponent } from './miniplayer.component';

describe('MiniplayerComponent', () => {
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

  async function renderMiniplayer(initialState: MiniplayerState | null = null) {
    const state = signal<MiniplayerState | null>(initialState);
    const playerService = {
      state,
      details: signal<PlayerDetails | null>(null),
      close: vi.fn(),
      saveProgress: vi.fn(),
      handBack: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [MiniplayerComponent],
      providers: [{ provide: PlayerService, useValue: playerService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MiniplayerComponent);
    fixture.detectChanges();

    return { fixture, playerService, state };
  }

  it('renders nothing when no scene is open', async () => {
    const { fixture } = await renderMiniplayer(null);

    expect(fixture.nativeElement.querySelector('.miniplayer')).toBeNull();
  });

  it('renders the video element with the resolved stream once ready', async () => {
    const { fixture } = await renderMiniplayer({
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
    const { fixture } = await renderMiniplayer({
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
    const { fixture } = await renderMiniplayer({
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
    const { fixture } = await renderMiniplayer({
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
    const { fixture } = await renderMiniplayer({
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
    const { fixture } = await renderMiniplayer({
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
    const { fixture, playerService } = await renderMiniplayer({
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
    const { fixture } = await renderMiniplayer({
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
    const { fixture, playerService } = await renderMiniplayer({
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
    const { fixture, playerService } = await renderMiniplayer({
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

  it('goes back to the scene page from the miniplayer, handing over the position', async () => {
    const { fixture, playerService } = await renderMiniplayer({
      title: 'A Scene',
      imageUrl: null,
      source: { streamUrl: '/stream', stashSceneId: '411', resumeSeconds: 0, duration: 600 },
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    playerService.details.set({
      detailsLink: { commands: ['/library/scene', '411'] },
    });
    const element = fixture.nativeElement as HTMLElement;
    const video = element.querySelector('video') as HTMLVideoElement;
    video.currentTime = 42;

    (element.querySelector('[aria-label="Back to the scene"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(playerService.handBack).toHaveBeenCalledWith('411', 42);
    expect(navigate).toHaveBeenCalledWith(['/library/scene', '411'], {
      queryParams: { autoplay: '1' },
    });
  });

  it('closes on Escape, saving the position', async () => {
    const { fixture, playerService } = await renderMiniplayer({
      title: 'A Scene',
      imageUrl: null,
      source: { streamUrl: '/stream', stashSceneId: '411', resumeSeconds: 0, duration: 600 },
    });
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });
    video.currentTime = 20;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(playerService.saveProgress).toHaveBeenCalledWith('411', 20, 600);
    expect(playerService.close).toHaveBeenCalled();
  });

  it('stays put when there is no scene page to go back to', async () => {
    const { fixture, playerService } = await renderMiniplayer({
      title: 'A Scene',
      imageUrl: null,
      source: { streamUrl: '/stream', stashSceneId: '411', resumeSeconds: 0, duration: 600 },
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (fixture.nativeElement.querySelector('[aria-label="Back to the scene"]') as HTMLButtonElement).click();

    expect(navigate).not.toHaveBeenCalled();
    expect(playerService.handBack).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.miniplayer')).toBeTruthy();
  });

  it('draws a progress line along the miniplayer that follows playback', async () => {
    const { fixture } = await renderMiniplayer({
      title: 'A Scene',
      imageUrl: null,
      source: { streamUrl: '/stream', stashSceneId: '411', resumeSeconds: 0, duration: 600 },
    });
    const element = fixture.nativeElement as HTMLElement;
    const video = element.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 600, configurable: true });

    video.currentTime = 150;
    video.dispatchEvent(new Event('timeupdate'));
    fixture.detectChanges();

    const bar = element.querySelector('.mini-progress') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect((bar.querySelector('.mini-progress-fill') as HTMLElement).style.transform).toBe(
      'scaleX(0.25)',
    );
  });
});
