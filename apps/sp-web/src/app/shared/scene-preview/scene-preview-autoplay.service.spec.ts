import { TestBed } from '@angular/core/testing';
import {
  ScenePreviewAutoplayItem,
  ScenePreviewAutoplayService,
} from './scene-preview-autoplay.service';

// 1024x768 viewport (jsdom default); the target is a third down: y = 256.
function item(top: number, height = 200, eligible = true) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  host.getBoundingClientRect = () =>
    ({ top, bottom: top + height, left: 312, right: 712, width: 400, height }) as DOMRect;
  const result = {
    host,
    autoplayEligible: eligible,
    isActive: false,
    playNow: vi.fn(() => (result.isActive = true)),
    prefetch: vi.fn(() => (result.isActive = true)),
    stop: vi.fn(() => (result.isActive = false)),
  } satisfies ScenePreviewAutoplayItem & { isActive: boolean };
  return result;
}

describe('ScenePreviewAutoplayService', () => {
  let service: ScenePreviewAutoplayService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
    TestBed.configureTestingModule({});
    service = TestBed.inject(ScenePreviewAutoplayService);
    service.touchScreen = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('plays the eligible thumbnail nearest the top third once scrolling has stopped', () => {
    const top = item(-60); // centre 40: further from 256
    const middle = item(150); // centre 250: nearest
    const lower = item(420); // centre 520
    const offScreen = item(700); // only 68px of 200 visible
    const notEligible = item(290, 200, false);
    [top, middle, lower, offScreen, notEligible].forEach((i) => service.register(i));

    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(80);
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(80);
    expect(middle.playNow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30);
    expect(middle.playNow).toHaveBeenCalledTimes(1);
    expect(top.playNow).not.toHaveBeenCalled();
    expect(lower.playNow).not.toHaveBeenCalled();
    expect(offScreen.playNow).not.toHaveBeenCalled();
    expect(notEligible.playNow).not.toHaveBeenCalled();
  });

  it('keeps the playing preview going while scrolling until it is mostly off screen', () => {
    const middle = item(150);
    service.register(middle);
    vi.advanceTimersByTime(200);
    expect(middle.playNow).toHaveBeenCalledTimes(1);

    // Scrolled a bit: still on screen, carries on.
    middle.host.getBoundingClientRect = () =>
      ({ top: -60, bottom: 140, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    expect(middle.stop).not.toHaveBeenCalled();

    // Scrolled mostly off the top: stops.
    middle.host.getBoundingClientRect = () =>
      ({ top: -180, bottom: 20, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    expect(middle.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the playing one when another starts', () => {
    const first = item(150);
    const second = item(500);
    service.register(first);
    service.register(second);
    vi.advanceTimersByTime(200);
    expect(first.playNow).toHaveBeenCalled();

    // Scrolled so the second is nearest the top third, the first still showing.
    first.host.getBoundingClientRect = () =>
      ({ top: 0, bottom: 200, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    second.host.getBoundingClientRect = () =>
      ({ top: 180, bottom: 380, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    expect(first.stop).not.toHaveBeenCalled();
    expect(second.prefetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.playNow).toHaveBeenCalledTimes(1);
  });

  it('loads the next pick ahead while scrolling, so it starts as soon as scrolling stops', () => {
    const first = item(150);
    const second = item(900);
    service.register(first);
    service.register(second);
    vi.advanceTimersByTime(200);
    expect(first.playNow).toHaveBeenCalled();

    second.host.getBoundingClientRect = () =>
      ({ top: 150, bottom: 350, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    first.host.getBoundingClientRect = () =>
      ({ top: -500, bottom: -300, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    // A long scroll: events keep coming every 50ms.
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(50);
    }
    expect(second.prefetch).toHaveBeenCalledTimes(1);
    expect(second.playNow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(second.playNow).toHaveBeenCalledTimes(1);
  });

  it('switches to the new middle thumbnail after the next scroll', () => {
    const first = item(300);
    const second = item(900);
    service.register(first);
    service.register(second);
    vi.advanceTimersByTime(400);
    expect(first.playNow).toHaveBeenCalled();

    first.host.getBoundingClientRect = () =>
      ({ top: -500, bottom: -300, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    second.host.getBoundingClientRect = () =>
      ({ top: 300, bottom: 500, left: 312, right: 712, width: 400, height: 200 }) as DOMRect;
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(400);

    expect(first.stop).toHaveBeenCalled();
    expect(second.playNow).toHaveBeenCalled();
  });

  it('holds autoplay off while a held element (Home hero) is on screen', () => {
    const hero = document.createElement('div');
    document.body.appendChild(hero);
    hero.getBoundingClientRect = () =>
      ({ top: 0, bottom: 400, left: 0, right: 1024, width: 1024, height: 400 }) as DOMRect;
    const lower = item(420);
    service.holdWhileOnScreen(hero, 0.25);
    service.register(lower);
    vi.advanceTimersByTime(200);
    expect(lower.playNow).not.toHaveBeenCalled();

    // Scrolled until under a quarter of the hero shows: the thumbnail plays.
    hero.getBoundingClientRect = () =>
      ({ top: -320, bottom: 80, left: 0, right: 1024, width: 1024, height: 400 }) as DOMRect;
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(200);
    expect(lower.playNow).toHaveBeenCalledTimes(1);

    // Back up to the hero: the thumbnail stops.
    hero.getBoundingClientRect = () =>
      ({ top: 0, bottom: 400, left: 0, right: 1024, width: 1024, height: 400 }) as DOMRect;
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(200);
    expect(lower.stop).toHaveBeenCalled();
    expect(lower.playNow).toHaveBeenCalledTimes(1);

    service.releaseHold(hero);
    vi.advanceTimersByTime(200);
    expect(lower.playNow).toHaveBeenCalledTimes(2);
  });

  it('does nothing on devices with a mouse, or while a full-screen video is playing', () => {
    const middle = item(300);
    service.touchScreen = false;
    service.register(middle);
    vi.advanceTimersByTime(400);
    expect(middle.playNow).not.toHaveBeenCalled();

    service.touchScreen = true;
    const player = document.createElement('video');
    Object.defineProperty(player, 'paused', { value: false });
    player.getBoundingClientRect = () =>
      ({ top: 0, bottom: 768, left: 0, right: 1024, width: 1024, height: 768 }) as DOMRect;
    document.body.appendChild(player);
    service.register(item(600));
    vi.advanceTimersByTime(400);
    expect(middle.playNow).not.toHaveBeenCalled();
  });

  it('still previews what is below a small pinned player (scene page, miniplayer)', () => {
    const player = document.createElement('video');
    Object.defineProperty(player, 'paused', { value: false });
    player.getBoundingClientRect = () =>
      ({ top: 0, bottom: 200, left: 0, right: 1024, width: 1024, height: 200 }) as DOMRect;
    document.body.appendChild(player);
    const middle = item(300);
    service.register(middle);
    vi.advanceTimersByTime(400);
    expect(middle.playNow).toHaveBeenCalledTimes(1);
  });
});
