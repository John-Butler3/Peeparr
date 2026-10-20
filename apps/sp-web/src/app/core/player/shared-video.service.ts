import { Injectable, signal } from '@angular/core';

/**
 * The one <video> element a scene plays in, wherever it's shown: the scene
 * page's player and the miniplayer take turns hosting it (it's moved, not
 * recreated). A new element would end an AirPlay session (and restart
 * buffering); the same element carries on, on the Apple TV too.
 *
 * Between hosts (leaving the page, before the miniplayer appears) it waits
 * in a holder that's always in the page: a video taken out of the page
 * pauses. Given where it was on screen, it waits there, still showing, and
 * then flies -- moving and shrinking or growing -- into the next player's
 * spot (followed as it moves, e.g. the miniplayer sliding in).
 */
export interface SharedVideoOptions {
  /** Native controls (the page's player) or none (the miniplayer). */
  controls: boolean;
  poster?: string | null;
}

@Injectable({ providedIn: 'root' })
export class SharedVideoService {
  static readonly FLIGHT_MS = 340;
  /** With no miniplayer spot to head for: dragging this far shrinks it to DRAG_MIN_SCALE. */
  static readonly DRAG_SHRINK_PX = 400;
  static readonly DRAG_MIN_SCALE = 0.5;
  /** A paused video swiped away: how long it takes to fade. */
  static readonly DISMISS_MS = 180;
  /** Longest a flight waits for its page to show (pages load hidden). */
  static readonly WAIT_FOR_PAGE_MS = 1500;
  /**
   * Switching to (or from) AirPlay, Safari can pause the video on its way
   * over; a pause this soon after the switch isn't yours, so it plays on.
   */
  static readonly AIRPLAY_SWITCH_MS = 3000;
  /** Parked this long with no player taking it: stop it. */
  static readonly UNCLAIMED_MS = 8000;

  private element: HTMLVideoElement | null = null;
  /** The scene loaded in it (for showing what can be done with it). */
  readonly loadedScene = signal<string | null>(null);
  private holder: HTMLElement | null = null;
  private owner: object | null = null;
  /** The Stash scene loaded into it. */
  private sceneId: string | null = null;
  /** Waiting on screen to fly to the next player. */
  private waitingOnScreen = false;
  /** Lifted out of its player's slot (still its player's), and that slot. */
  private liftedFrom: HTMLElement | null = null;
  private liftedControls = false;
  /** A swiped-away video's fade (kept, filled, until the holder is reset). */
  private dismissing: Animation | null = null;
  /** Where it was when lifted (dragging moves it from there). */
  private liftRect: DOMRect | null = null;
  private flight: number | null = null;
  private unclaimedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Playing, as far as you're concerned (kept through an AirPlay switch). */
  private wantsToPlay = false;
  private switchingUntil = 0;

  get video(): HTMLVideoElement {
    if (!this.element) {
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      video.setAttribute('x-webkit-airplay', 'allow');
      // Leaving the app (going home on an iPhone) while it plays: it carries
      // on in a picture-in-picture window (Safari's automatic PiP).
      video.setAttribute('autopictureinpicture', '');
      (video as HTMLVideoElement & { autoPictureInPicture?: boolean }).autoPictureInPicture = true;
      this.allowAutomaticPictureInPicture(video);
      video.style.cssText = 'display:block;width:100%;height:100%;background:#000;';
      this.keepPlayingThroughAirPlaySwitch(video);
      this.element = video;
    }
    return this.element;
  }

  /** Whether this browser can float the video in a picture-in-picture window. */
  pictureInPictureSupported(): boolean {
    const video = this.video as WebKitVideo;
    return (
      document.pictureInPictureEnabled === true ||
      (typeof video.webkitSupportsPresentationMode === 'function' &&
        video.webkitSupportsPresentationMode('picture-in-picture'))
    );
  }

  /**
   * Floats the video in a picture-in-picture window, where it carries on
   * when the app is left. Only from a tap (browsers require it), and once
   * the video has loaded.
   */
  enterPictureInPicture(): void {
    const video = this.element as WebKitVideo | null;
    if (!video || !video.getAttribute('src')) {
      return;
    }
    // Asked first, straight from the tap (iPhone won't otherwise), then playing.
    if (typeof video.webkitSetPresentationMode === 'function') {
      video.webkitSetPresentationMode('picture-in-picture');
    } else {
      void video.requestPictureInPicture?.().catch(() => undefined);
    }
    if (video.paused) {
      void video.play().catch(() => undefined);
    }
  }

  /**
   * Chrome's version of the same (installed web apps): asked to go
   * picture-in-picture as the app is left, it does, if it's playing.
   */
  private allowAutomaticPictureInPicture(video: HTMLVideoElement): void {
    if (!('mediaSession' in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => {
        if (!video.paused && document.pictureInPictureElement !== video) {
          void video.requestPictureInPicture?.().catch(() => undefined);
        }
      });
    } catch {
      // Not a known action in this browser.
    }
  }

  /**
   * Shows the video in `slot` for `owner`. With that scene already loaded
   * (handed over from the other player) it carries on as it is and this
   * returns true; otherwise it loads `src` and returns false.
   */
  attach(
    owner: object,
    slot: HTMLElement,
    sceneId: string,
    src: string,
    options: SharedVideoOptions = { controls: false },
  ): boolean {
    const video = this.video;
    this.owner = owner;
    this.liftedFrom = null;
    this.clearUnclaimed();
    // The same scene at the same quality carries on (its token may differ).
    const carriesOn =
      this.sceneId === sceneId && sameStream(video.getAttribute('src'), src) && !video.ended;
    if (!carriesOn) {
      this.sceneId = sceneId;
      this.loadedScene.set(sceneId);
      video.src = src;
    }
    if (options.poster) {
      video.poster = options.poster;
    } else {
      video.removeAttribute('poster');
    }
    const land = () => {
      if (this.owner !== owner) {
        return;
      }
      if (video.parentElement !== slot) {
        slot.appendChild(video);
      }
      video.controls = options.controls;
      video.style.opacity = '';
      this.hideHolder();
    };
    if (carriesOn && this.waitingOnScreen && video.parentElement === this.holder) {
      this.flyTo(slot, land);
    } else {
      this.stopFlight();
      land();
    }
    return carriesOn;
  }

  isOwner(owner: object): boolean {
    return this.owner === owner;
  }

  /**
   * Leaving a page while its video plays: lifts the video out of the page,
   * on screen exactly where it is, so the page can fade out under it before
   * it flies (and so it isn't taken out of the document with a page that's
   * kept, which would pause it). True if it did.
   */
  liftIfPlaying(): boolean {
    return this.lift(true);
  }

  /** For a drag by hand: lifts it playing or paused. True if it did. */
  liftForDrag(): boolean {
    return this.lift(false);
  }

  /** Whether this scene is loaded in it (playing or paused). */
  hasScene(sceneId: string): boolean {
    const video = this.element;
    return !!video && this.sceneId === sceneId && !!video.getAttribute('src') && !video.ended;
  }

  private lift(onlyIfPlaying: boolean): boolean {
    const video = this.element;
    const slot = video?.parentElement ?? null;
    if (
      !video ||
      !slot ||
      this.owner === null ||
      (onlyIfPlaying && video.paused) ||
      video.ended ||
      !video.getAttribute('src') ||
      slot === this.holder
    ) {
      return false;
    }
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    this.liftedFrom = slot;
    this.liftRect = rect;
    this.liftedControls = video.controls;
    video.controls = false;
    this.waitingOnScreen = true;
    const holder = this.parkingSpot();
    if (holder.nextElementSibling) {
      document.body.appendChild(holder);
    }
    this.placeHolder(rect.left, rect.top, rect.width, rect.height);
    holder.appendChild(video);
    return true;
  }

  isLifted(): boolean {
    return this.liftedFrom !== null;
  }

  /**
   * A lifted video following a downward drag: moves down with the finger,
   * and on its way it slides across and shrinks towards the miniplayer's
   * spot, arriving as the finger reaches it.
   */
  moveLifted(dy: number): void {
    const rect = this.liftRect;
    if (!this.liftedFrom || !rect) {
      return;
    }
    const down = Math.max(0, dy);
    const target = document.querySelector('.mini-target')?.getBoundingClientRect();
    if (target && target.width > 0 && target.top > rect.top) {
      this.moveLiftedTo(target, down / (target.top - rect.top));
      return;
    }
    this.moveLiftedDown(down);
  }

  /** A lifted video part of the way (0 to 1) from where it was lifted to `target`. */
  moveLiftedTo(target: DOMRect, progress: number): void {
    const rect = this.liftRect;
    if (!this.liftedFrom || !rect) {
      return;
    }
    const t = Math.min(1, Math.max(0, progress));
    this.stopFlight();
    this.placeHolder(
      rect.left + (target.left - rect.left) * t,
      rect.top + (target.top - rect.top) * t,
      rect.width + (target.width - rect.width) * t,
      rect.height + (target.height - rect.height) * t,
    );
  }

  /**
   * A lifted video dragged straight down (paused: closing, not off to the
   * miniplayer): with the finger, shrinking and fading as it goes.
   */
  moveLiftedDown(dy: number): void {
    const rect = this.liftRect;
    if (!this.liftedFrom || !rect) {
      return;
    }
    const down = Math.max(0, dy);
    const scale = Math.max(
      SharedVideoService.DRAG_MIN_SCALE,
      1 - (down / SharedVideoService.DRAG_SHRINK_PX) * (1 - SharedVideoService.DRAG_MIN_SCALE),
    );
    const width = rect.width * scale;
    const height = rect.height * scale;
    this.stopFlight();
    this.placeHolder(rect.left + (rect.width - width) / 2, rect.top + down, width, height);
    this.parkingSpot().style.opacity = String(
      Math.max(0.3, 1 - down / SharedVideoService.DRAG_SHRINK_PX),
    );
  }

  /** A lifted video let go to close: fades away where it is (then resolves). */
  dismissLifted(): Promise<void> {
    const holder = this.holder;
    if (!this.liftedFrom || !holder || typeof holder.animate !== 'function') {
      return Promise.resolve();
    }
    this.stopFlight();
    const from = Number(holder.style.opacity || '1');
    this.dismissing?.cancel();
    this.dismissing = holder.animate(
      [
        { opacity: from, transform: 'translateZ(0) scale(1)' },
        { opacity: 0, transform: 'translateZ(0) scale(0.9)' },
      ],
      { duration: SharedVideoService.DISMISS_MS, easing: 'ease-in', fill: 'forwards' },
    );
    return this.dismissing.finished.then(
      () => undefined,
      () => undefined,
    );
  }

  /** A drag let go short of the miniplayer: glides back into its player. */
  dropBack(): void {
    const slot = this.liftedFrom;
    if (!slot) {
      return;
    }
    this.flyTo(slot, () => this.putBack());
  }

  /** The page change didn't happen after all: back into its player. */
  putBack(): void {
    const video = this.element;
    const slot = this.liftedFrom;
    this.liftedFrom = null;
    this.liftRect = null;
    if (!video || !slot || !slot.isConnected || this.owner === null) {
      return;
    }
    this.stopFlight();
    slot.appendChild(video);
    video.controls = this.liftedControls;
    this.hideHolder();
  }

  /** Whether this scene is loaded and playing (worth handing over). */
  isPlaying(sceneId: string): boolean {
    const video = this.element;
    return !!video && this.sceneId === sceneId && !video.paused && !video.ended;
  }

  /**
   * Keeps it playing until the next player takes it. Given where it is on
   * screen (`from`), it stays there, showing, to fly to that player.
   */
  park(owner: object, from?: DOMRect | null, poster?: string | null): void {
    const video = this.element;
    if (this.owner !== owner || !video) {
      return;
    }
    this.owner = null;
    this.liftedFrom = null;
    this.stopFlight();
    const holder = this.parkingSpot();
    if (holder.nextElementSibling) {
      // Last in the page, so nothing added since (dialogs, toasts) is above.
      document.body.appendChild(holder);
    }
    if (from && from.width > 0 && from.height > 0 && !prefersReducedMotion()) {
      this.waitingOnScreen = true;
      video.controls = false;
      this.placeHolder(from.left, from.top, from.width, from.height);
      // The scene's picture behind it: shows while the video has no picture
      // here (e.g. it's playing on an Apple TV).
      holder.style.backgroundImage = poster ? `url("${poster.replace(/"/g, '%22')}")` : '';
      holder.style.backgroundSize = 'cover';
      holder.style.backgroundPosition = 'center';
      if (isWireless(video)) {
        video.style.opacity = '0';
      }
    } else {
      this.hideHolder();
    }
    holder.appendChild(video);
    this.clearUnclaimed();
    this.unclaimedTimer = setTimeout(() => {
      this.unclaimedTimer = null;
      if (this.owner === null) {
        this.stop();
      }
    }, SharedVideoService.UNCLAIMED_MS);
  }

  /** Stops it if it's one of these scenes (deleted), whichever player has it. */
  stopScene(sceneIds: readonly string[]): void {
    if (this.sceneId && sceneIds.includes(this.sceneId)) {
      this.owner = null;
      this.stop();
    }
  }

  /** Stops it: its player is done with it. */
  release(owner: object): void {
    if (this.owner !== owner || !this.element) {
      return;
    }
    this.owner = null;
    this.stop();
  }

  private stop(): void {
    const video = this.element;
    if (!video) {
      return;
    }
    this.wantsToPlay = false;
    video.style.opacity = '';
    this.stopFlight();
    this.clearUnclaimed();
    this.sceneId = null;
    this.loadedScene.set(null);
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    try {
      video.load();
    } catch {
      // Not implemented everywhere (tests); the source is gone either way.
    }
    this.hideHolder();
    this.parkingSpot().appendChild(video);
  }

  private keepPlayingThroughAirPlaySwitch(video: HTMLVideoElement): void {
    const switching = () => {
      this.switchingUntil = Date.now() + SharedVideoService.AIRPLAY_SWITCH_MS;
      this.resumeIfWanted(video);
    };
    // Safari's AirPlay event, and the standard Remote Playback API.
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', switching);
    const remote = (video as HTMLVideoElement & { remote?: EventTarget }).remote;
    for (const type of ['connecting', 'connect', 'disconnect']) {
      remote?.addEventListener?.(type, switching);
    }
    video.addEventListener('play', () => {
      this.wantsToPlay = true;
    });
    video.addEventListener('pause', () => {
      if (Date.now() < this.switchingUntil && this.wantsToPlay && !video.ended) {
        // The switch, not you: carry on (once the switch has settled).
        setTimeout(() => this.resumeIfWanted(video), 0);
        return;
      }
      this.wantsToPlay = false;
    });
    video.addEventListener('ended', () => {
      this.wantsToPlay = false;
    });
  }

  private resumeIfWanted(video: HTMLVideoElement): void {
    if (this.wantsToPlay && video.paused && !video.ended && video.getAttribute('src')) {
      video.play()?.catch(() => undefined);
    }
  }

  /**
   * Moves and resizes the holder (with the video in it) from where it is to
   * `slot`, following the slot if it moves meanwhile, then lands it there.
   */
  private flyTo(slot: HTMLElement, land: () => void): void {
    this.stopFlight();
    const from = this.parkingSpot().getBoundingClientRect();
    let start: number | null = null;
    let waitingSince: number | null = null;
    const step = (now: number) => {
      if (!slot.isConnected) {
        this.flight = null;
        land();
        return;
      }
      // Its page is still loading (hidden), or the page before it is still
      // on its way out (pushing it down): stay put, showing, until it's
      // settled, rather than flying to where it isn't going to be.
      if (start === null && (slot.closest('.is-pending') || pageStillLeaving(slot))) {
        waitingSince ??= now;
        if (now - waitingSince < SharedVideoService.WAIT_FOR_PAGE_MS) {
          this.flight = requestAnimationFrame(step);
          return;
        }
      }
      start ??= now;
      const t = Math.min(1, (now - start) / SharedVideoService.FLIGHT_MS);
      const e = 1 - Math.pow(1 - t, 3);
      const to = slot.getBoundingClientRect();
      this.placeHolder(
        from.left + (to.left - from.left) * e,
        from.top + (to.top - from.top) * e,
        from.width + (to.width - from.width) * e,
        from.height + (to.height - from.height) * e,
      );
      if (t < 1) {
        this.flight = requestAnimationFrame(step);
      } else {
        this.flight = null;
        land();
      }
    };
    this.flight = requestAnimationFrame(step);
  }

  private stopFlight(): void {
    if (this.flight !== null) {
      cancelAnimationFrame(this.flight);
      this.flight = null;
    }
  }

  private clearUnclaimed(): void {
    if (this.unclaimedTimer) {
      clearTimeout(this.unclaimedTimer);
      this.unclaimedTimer = null;
    }
  }

  /** The holder on screen at this spot, above everything, showing the video. */
  private placeHolder(left: number, top: number, width: number, height: number): void {
    this.dismissing?.cancel();
    this.dismissing = null;
    Object.assign(this.parkingSpot().style, {
      left: `${left}px`,
      top: `${top}px`,
      bottom: 'auto',
      width: `${width}px`,
      height: `${height}px`,
      opacity: '1',
      borderRadius: '12px',
      backgroundColor: '#000',
      boxShadow: '0 10px 30px rgb(0 0 0 / 40%)',
      // In front of everything (pages, the bars, the miniplayer). Its own
      // layer: Safari can draw an animating page (its own layer) over a
      // fixed element that isn't one, whatever the z-index.
      zIndex: '2500',
      transform: 'translateZ(0)',
      willChange: 'transform',
      isolation: 'isolate',
    });
  }

  private hideHolder(): void {
    this.dismissing?.cancel();
    this.dismissing = null;
    this.waitingOnScreen = false;
    if (this.holder) {
      this.holder.style.cssText = HIDDEN_HOLDER;
    }
  }

  private parkingSpot(): HTMLElement {
    if (!this.holder || !this.holder.isConnected) {
      const holder = document.createElement('div');
      holder.setAttribute('aria-hidden', 'true');
      holder.style.cssText = HIDDEN_HOLDER;
      document.body.appendChild(holder);
      this.holder = holder;
    }
    return this.holder;
  }
}

// In the page (so the video keeps playing) but out of sight. Not
// display:none: that can stop a video's picture updating.
const HIDDEN_HOLDER =
  'position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';

/** Another page is still in the page area alongside the slot's (leaving). */
function pageStillLeaving(slot: HTMLElement): boolean {
  const area = slot.closest('.route-view');
  return !!area && area.querySelectorAll(':scope > :not(router-outlet)').length > 1;
}

function isWireless(video: HTMLVideoElement): boolean {
  return !!(video as HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean })
    .webkitCurrentPlaybackTargetIsWireless;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The same stream address, but for its access token (?st=, issued afresh each time). */
function sameStream(current: string | null, next: string): boolean {
  if (!current) {
    return false;
  }
  const withoutToken = (url: string) => {
    const parsed = new URL(url, 'http://x');
    parsed.searchParams.delete('st');
    return parsed.pathname + parsed.search;
  };
  return withoutToken(current) === withoutToken(next);
}

/** Safari's own picture-in-picture calls (iPhone). */
type WebKitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
};
