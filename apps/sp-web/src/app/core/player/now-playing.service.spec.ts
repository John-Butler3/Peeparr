import { TestBed } from '@angular/core/testing';
import { NowPlayingService } from './now-playing.service';

describe('NowPlayingService', () => {
  let service: NowPlayingService;
  let session: {
    metadata: unknown;
    playbackState: string;
    setActionHandler: ReturnType<typeof vi.fn>;
  };
  let originalMediaSession: PropertyDescriptor | undefined;
  let originalMediaMetadata: typeof globalThis.MediaMetadata | undefined;

  beforeEach(() => {
    // jsdom has neither the Media Session API nor MediaMetadata.
    session = { metadata: null, playbackState: 'none', setActionHandler: vi.fn() };
    originalMediaSession = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
    originalMediaMetadata = globalThis.MediaMetadata;
    globalThis.MediaMetadata = class {
      constructor(init: object) {
        Object.assign(this, init);
      }
    } as unknown as typeof globalThis.MediaMetadata;
    service = TestBed.inject(NowPlayingService);
  });

  afterEach(() => {
    if (originalMediaSession) {
      Object.defineProperty(navigator, 'mediaSession', originalMediaSession);
    } else {
      delete (navigator as { mediaSession?: unknown }).mediaSession;
    }
    globalThis.MediaMetadata = originalMediaMetadata as typeof globalThis.MediaMetadata;
    TestBed.resetTestingModule();
  });

  const artwork = () =>
    (session.metadata as { artwork: Array<{ src: string; sizes: string; type?: string }> })
      .artwork;

  const handlers = () =>
    new Map<string, unknown>(session.setActionHandler.mock.calls.map(([a, h]) => [a, h]));

  it('puts up the title, who is in it, the site and the thumbnail, with handlers', () => {
    const video = document.createElement('video');
    service.show(video, {
      title: 'A Scene',
      imageUrl: '/api/media/stash/scenes/7/screenshot',
      details: { performers: ['Ann', 'Bea'], studio: 'A Site' },
    });

    expect(session.metadata).toMatchObject({
      title: 'A Scene',
      artist: 'Ann, Bea',
      album: 'A Site',
    });
    // The logo, while the thumbnail is made square.
    expect(artwork()).toEqual([
      { src: `${location.origin}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
    ]);
    expect(session.playbackState).toBe('playing');
    for (const action of ['play', 'pause', 'seekto', 'seekbackward', 'seekforward']) {
      expect(handlers().get(action)).toEqual(expect.any(Function));
    }
  });

  it('keeps the details up as the video starts again, and its state in step', () => {
    const video = document.createElement('video');
    service.show(video, { title: 'A Scene', imageUrl: null });
    session.metadata = null;

    video.dispatchEvent(new Event('pause'));
    expect(session.playbackState).toBe('paused');

    video.dispatchEvent(new Event('playing'));
    expect(session.metadata).toMatchObject({ title: 'A Scene' });
    expect(artwork()[0].src).toBe(`${location.origin}/icons/icon-512.png`);
    expect(session.playbackState).toBe('playing');
  });

  it('clears everything, and no longer follows the video', () => {
    const video = document.createElement('video');
    service.show(video, { title: 'A Scene', imageUrl: null });
    service.clear();

    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    for (const action of ['play', 'pause', 'seekto', 'seekbackward', 'seekforward']) {
      expect(handlers().get(action)).toBeNull();
    }
    video.dispatchEvent(new Event('playing'));
    expect(session.metadata).toBeNull();
  });

  it('works the handlers on the video', () => {
    const video = document.createElement('video');
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    service.show(video, { title: 'A Scene', imageUrl: null });
    const h = handlers() as Map<string, (details: MediaSessionActionDetails) => void>;

    h.get('play')!({ action: 'play' });
    h.get('pause')!({ action: 'pause' });
    h.get('seekto')!({ action: 'seekto', seekTime: 42 });
    expect(play).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(42);
  });

  it('swaps in the thumbnail, cropped square, once it has loaded', () => {
    const images: Array<{ src: string; onload: (() => void) | null }> = [];
    const OriginalImage = globalThis.Image;
    globalThis.Image = class {
      naturalWidth = 1280;
      naturalHeight = 720;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      constructor() {
        images.push(this);
      }
    } as unknown as typeof Image;
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,AAAA');
    try {
      const video = document.createElement('video');
      service.show(video, { title: 'A Scene', imageUrl: '/api/media/stash/scenes/7/screenshot' });
      expect(images).toHaveLength(1);
      expect(images[0].src).toBe(`${location.origin}/api/media/stash/scenes/7/screenshot`);

      images[0].onload?.();

      // The middle of the 16:9 picture.
      expect(drawImage).toHaveBeenCalledWith(images[0], 280, 0, 720, 720, 0, 0, 512, 512);
      expect(artwork()).toEqual([
        { src: 'data:image/jpeg;base64,AAAA', sizes: '512x512', type: 'image/jpeg' },
      ]);
      expect(session.metadata).toMatchObject({ title: 'A Scene' });

      // Made once: playing again uses it straight away.
      service.show(video, { title: 'A Scene', imageUrl: '/api/media/stash/scenes/7/screenshot' });
      expect(images).toHaveLength(1);
      expect(artwork()[0].src).toBe('data:image/jpeg;base64,AAAA');
    } finally {
      globalThis.Image = OriginalImage;
      getContext.mockRestore();
      toDataURL.mockRestore();
    }
  });
});
