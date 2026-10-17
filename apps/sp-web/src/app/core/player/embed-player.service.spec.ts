import { TestBed } from '@angular/core/testing';
import { EmbedPlayerService } from './embed-player.service';

describe('EmbedPlayerService', () => {
  let service: EmbedPlayerService;
  const scenePage = {};
  const miniplayer = {};
  const url = 'https://www.pornhub.com/embed/abc123def';

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    service = TestBed.inject(EmbedPlayerService);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.embed-layer').forEach((layer) => layer.remove());
    TestBed.resetTestingModule();
  });

  function spot(rect: DOMRect): HTMLElement {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => rect;
    document.body.appendChild(element);
    return element;
  }
  const frames = () => document.querySelectorAll('.embed-layer iframe');
  const layer = () => document.querySelector<HTMLElement>('.embed-layer')!;

  it("is one player laid over its spot, never moved, so it's never reloaded", () => {
    service.attach(scenePage, spot(new DOMRect(0, 0, 390, 219)), url, 'page');
    vi.advanceTimersByTime(50);
    const frame = frames()[0] as HTMLIFrameElement;
    expect(frame.src).toBe(url);
    expect(layer().style.width).toBe('390px');
    // On the page: under the bars, using Pornhub's controls, with the grab strip.
    expect(layer().style.zIndex).toBe(EmbedPlayerService.PAGE_LAYER);
    expect(layer().style.pointerEvents).toBe('auto');

    // Leaving the page: waits where it was, then flies into the miniplayer.
    service.park(scenePage, new DOMRect(0, 0, 390, 219));
    service.attach(miniplayer, spot(new DOMRect(13, 708, 100, 56)), url, 'mini');
    vi.advanceTimersByTime(EmbedPlayerService.FLIGHT_MS + 100);

    expect(frames()).toHaveLength(1);
    expect(frames()[0]).toBe(frame);
    expect(frame.src).toBe(url);
    expect(layer().style.width).toBe('100px');
    // In the miniplayer, taps go through to it.
    expect(layer().style.pointerEvents).toBe('none');
  });

  it('stops when its player is done, or when nothing takes it', () => {
    service.attach(scenePage, spot(new DOMRect(0, 0, 390, 219)), url, 'page');
    service.release(miniplayer);
    expect(frames()).toHaveLength(1);
    service.release(scenePage);
    expect(frames()).toHaveLength(0);
    expect(service.has(url)).toBe(false);

    service.attach(scenePage, spot(new DOMRect(0, 0, 390, 219)), url, 'page');
    service.park(scenePage, new DOMRect(0, 0, 390, 219));
    vi.advanceTimersByTime(EmbedPlayerService.UNCLAIMED_MS);
    expect(frames()).toHaveLength(0);
  });

  it('a drag lifts it on top and moves it towards a target; let go short, it goes back', () => {
    const page = spot(new DOMRect(0, 0, 390, 219));
    service.attach(scenePage, page, url, 'page');
    vi.advanceTimersByTime(50);

    // (jsdom doesn't lay anything out: the layer's place, as the browser would report it.)
    layer().getBoundingClientRect = () => new DOMRect(0, 0, 390, 219);
    expect(service.lift(scenePage)).toBe(true);
    expect(layer().style.zIndex).toBe(EmbedPlayerService.TOP_LAYER);
    service.moveLiftedTo(new DOMRect(13, 708, 100, 56), 0.5);
    expect(layer().style.width).toBe('245px');

    service.dropBack();
    vi.advanceTimersByTime(EmbedPlayerService.FLIGHT_MS + 100);
    expect(layer().style.width).toBe('390px');
    expect(layer().style.zIndex).toBe(EmbedPlayerService.PAGE_LAYER);
  });
});
