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

  it('flies: waits on screen where it was, then moves and resizes into the next player', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const pageSlot = slot();
    service.attach(scenePage, pageSlot, '411', '/a', { controls: true });
    const video = service.video;
    expect(video.controls).toBe(true);

    // Leaving the page: shown where it was, without controls, above everything.
    service.park(scenePage, new DOMRect(0, 60, 400, 225));
    const holder = video.parentElement!;
    expect(holder).not.toBe(pageSlot);
    expect(holder.style.opacity).toBe('1');
    expect(holder.style.width).toBe('400px');
    expect(video.controls).toBe(false);

    const miniSlot = slot();
    miniSlot.getBoundingClientRect = () => new DOMRect(12, 700, 100, 56);
    holder.getBoundingClientRect = () => new DOMRect(0, 60, 400, 225);
    expect(service.attach(miniplayer, miniSlot, '411', '/a', { controls: false })).toBe(true);

    // Part way: still flying, smaller and lower.
    vi.advanceTimersByTime(SharedVideoService.FLIGHT_MS / 3);
    expect(video.parentElement).toBe(holder);
    expect(parseFloat(holder.style.width)).toBeLessThan(400);
    expect(parseFloat(holder.style.width)).toBeGreaterThan(100);
    expect(parseFloat(holder.style.top)).toBeGreaterThan(60);

    // Landed in the miniplayer; the holder hides again.
    vi.advanceTimersByTime(SharedVideoService.FLIGHT_MS);
    expect(video.parentElement).toBe(miniSlot);
    expect(holder.style.opacity).toBe('0');
    expect(pause).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('stops a parked video that no player takes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    service.attach(scenePage, slot(), '411', '/a');
    service.park(scenePage, new DOMRect(0, 0, 400, 225));

    vi.advanceTimersByTime(SharedVideoService.UNCLAIMED_MS);

    expect(pause).toHaveBeenCalled();
    expect(service.video.getAttribute('src')).toBeNull();
    expect(service.video.parentElement!.style.opacity).toBe('0');
    vi.useRealTimers();
  });

  it('keeps playing through the AirPlay switch, but a pause of yours stays paused', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    let paused = false;
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused);
    service.attach(scenePage, slot(), '411', '/a');
    const video = service.video;
    video.dispatchEvent(new Event('play'));

    // AirPlay chosen: Safari pauses it on the way over.
    video.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
    paused = true;
    video.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(0);
    expect(play).toHaveBeenCalledTimes(1);

    // Later, your own pause: left alone.
    paused = false;
    video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(SharedVideoService.AIRPLAY_SWITCH_MS);
    paused = true;
    video.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(0);
    expect(play).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("waits on screen while the next player's page is still loading (hidden), then flies", () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    service.attach(miniplayer, slot(), '411', '/a');
    const video = service.video;
    service.park(miniplayer, new DOMRect(12, 700, 100, 56), '/poster.jpg');
    const holder = video.parentElement!;
    expect(holder.style.backgroundImage).toContain('/poster.jpg');

    const page = document.createElement('div');
    page.className = 'route-view is-pending';
    const pageSlot = document.createElement('div');
    page.appendChild(pageSlot);
    document.body.appendChild(page);
    pageSlot.getBoundingClientRect = () => new DOMRect(0, 0, 390, 219);
    holder.getBoundingClientRect = () => new DOMRect(12, 700, 100, 56);
    service.attach(scenePage, pageSlot, '411', '/a', { controls: true });

    // Page hidden: stays where it was, showing.
    vi.advanceTimersByTime(600);
    expect(video.parentElement).toBe(holder);
    expect(holder.style.top).toBe('700px');

    // Page shows: flies up and lands.
    page.className = 'route-view';
    vi.advanceTimersByTime(SharedVideoService.FLIGHT_MS + 100);
    expect(video.parentElement).toBe(pageSlot);
    expect(video.controls).toBe(true);
    vi.useRealTimers();
  });
});
