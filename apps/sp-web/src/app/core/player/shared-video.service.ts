import { Injectable } from '@angular/core';

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
  private holder: HTMLElement | null = null;
  private owner: object | null = null;
  /** The Stash scene loaded into it. */
  private sceneId: string | null = null;
  /** Waiting on screen to fly to the next player. */
  private waitingOnScreen = false;
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
      video.style.cssText = 'display:block;width:100%;height:100%;background:#000;';
      this.keepPlayingThroughAirPlaySwitch(video);
      this.element = video;
    }
    return this.element;
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
    this.clearUnclaimed();
    const carriesOn = this.sceneId === sceneId && !!video.getAttribute('src') && !video.ended;
    if (!carriesOn) {
      this.sceneId = sceneId;
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
    this.stopFlight();
    const holder = this.parkingSpot();
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
      // Its page is still loading (hidden): stay put, showing, until it
      // appears, rather than landing somewhere invisible.
      if (start === null && slot.closest('.is-pending')) {
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
    Object.assign(this.parkingSpot().style, {
      left: `${left}px`,
      top: `${top}px`,
      bottom: 'auto',
      width: `${width}px`,
      height: `${height}px`,
      opacity: '1',
      borderRadius: '12px',
      background: '#000',
      boxShadow: '0 10px 30px rgb(0 0 0 / 40%)',
      zIndex: '1400',
    });
  }

  private hideHolder(): void {
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

function isWireless(video: HTMLVideoElement): boolean {
  return !!(video as HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean })
    .webkitCurrentPlaybackTargetIsWireless;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
