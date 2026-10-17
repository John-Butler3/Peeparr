import { TestBed } from '@angular/core/testing';
import { SharedVideoService } from './shared-video.service';

describe('SharedVideoService', () => {
  let service: SharedVideoService;
  let pause: ReturnType<typeof vi.spyOn>;
  const scenePage = {};
  const miniplayer = {};

  beforeEach(() => {
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    service = TestBed.inject(SharedVideoService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function slot(): HTMLElement {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  }

  it('is one element that moves between players and carries on (for AirPlay)', () => {
    const pageSlot = slot();
    expect(service.attach(scenePage, pageSlot, '411', '/stream?st=a')).toBe(false);
    const video = service.video;
    expect(video.parentElement).toBe(pageSlot);
    expect(video.getAttribute('src')).toBe('/stream?st=a');
    expect(video.getAttribute('x-webkit-airplay')).toBe('allow');

    // Leaving the page: waits in the page, not stopped.
    service.park(scenePage);
    expect(video.isConnected).toBe(true);
    expect(pause).not.toHaveBeenCalled();

    // The miniplayer takes the same element, with the same source: no reload.
    const miniSlot = slot();
    expect(service.attach(miniplayer, miniSlot, '411', '/stream?st=b')).toBe(true);
    expect(service.video).toBe(video);
    expect(video.parentElement).toBe(miniSlot);
    expect(video.getAttribute('src')).toBe('/stream?st=a');
  });

  it('loads another scene, and only its current player can stop it', () => {
    service.attach(scenePage, slot(), '411', '/a');
    service.attach(miniplayer, slot(), '412', '/b');
    expect(service.video.getAttribute('src')).toBe('/b');

    // The page player is no longer the owner: can't stop the miniplayer's.
    service.release(scenePage);
    expect(pause).not.toHaveBeenCalled();

    service.release(miniplayer);
    expect(pause).toHaveBeenCalled();
    expect(service.video.getAttribute('src')).toBeNull();
    expect(service.video.isConnected).toBe(true);
  });
});
