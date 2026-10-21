import { Injectable } from '@angular/core';

/** Where the embed is being shown, and how it behaves there. */
export type EmbedSpot = 'page' | 'mini';

/** The scene page's hooks: a drag on the grab strip, and Play pressed in the embed. */
export interface EmbedGrabHandlers {
  start(event: TouchEvent): void;
  /** You've started using the embed (tapped Play in it). */
  started?(): void;
}

/**
 * A scene streamed from Pornhub plays in Pornhub's embed player (an
 * iframe). An iframe moved in the page reloads, so unlike the shared video
 * it's never moved: it lives in one layer over the page, laid over whichever
 * spot shows it -- the scene page's player, or the miniplayer -- following
 * that spot, and flying between them.
 *
 * On the scene page the layer sits above the page but under the top and
 * bottom bars, and you use Pornhub's controls; a strip along its top edge
 * (covering Pornhub's title links, which would leave the app) is the grab
 * handle for swiping it down. In the miniplayer touches pass through it to
 * the miniplayer's own tap and swipe. Moving between spots it's on top.
 *
 * The embed is laid out at the scene page player's size wherever it is, and
 * scaled to fit: in the miniplayer it's that player made small (not
 * Pornhub's controls squeezed into a thumbnail), and moving it never makes
 * it lay itself out again.
 *
 * Pornhub's player doesn't say whether it's playing. A tap in it moves the
 * focus into it (this window loses it): that counts as started.
 *
 * Embedded, Pornhub's player never hides its title and control bar, and a
 * tap on the playing video opens it on Pornhub (leaving the app). So once
 * it's started, the video is covered (the shield: a swipe down anywhere on
 * it goes to the miniplayer, a tap on it shows the controls), leaving only
 * the control bar to use; and left alone for a few seconds, the controls
 * "fade": the player is laid out a little taller than its spot, the video
 * staying put, so its title and control bar are just outside it, cut off.
 * They're always cut off in the miniplayer. Before it's started nothing
 * covers it: the first tap is Play.
 */
@Injectable({ providedIn: 'root' })
export class EmbedPlayerService {
  static readonly FLIGHT_MS = 340;
  static readonly WAIT_FOR_PAGE_MS = 1500;
  static readonly UNCLAIMED_MS = 8000;
  /** Under the top bar (60) and bottom bar (55), over the page. */
  static readonly PAGE_LAYER = '50';
  /** In the miniplayer: just above it (1300), like its own video. */
  static readonly MINI_LAYER = '1301';
  /** Over everything while moving between spots, or dragged. */
  static readonly TOP_LAYER = '2500';
  static readonly GRAB_STRIP_PX = 44;
  /** Untouched this long: the controls (and the handle) fade. */
  static readonly IDLE_MS = 4000;
  /** How far past its spot the player reaches, above and below, with the controls hidden. */
  static readonly CROP_PX = 56;
  /** Pornhub's control bar, left uncovered while the controls show. */
  static readonly CONTROL_BAR_PX = 52;
  /**
   * While the controls show, the player's top-right corner is left
   * uncovered (this much of its width, and the top half): where Pornhub's
   * pop-ups ("watch the full scene") have their close button.
   */
  static readonly OPEN_CORNER = '30%';

  private layer: HTMLElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private grabStrip: HTMLElement | null = null;
  private shield: HTMLElement | null = null;
  private handle: HTMLElement | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pornhub's title and controls showing (else cut off). */
  private controlsShown = true;
  private label: HTMLElement | null = null;
  /** The size the embed is laid out at (the scene page player's). */
  private base: { width: number; height: number } | null = null;
  private started = false;
  private url: string | null = null;
  private owner: object | null = null;
  private spot: HTMLElement | null = null;
  private spotKind: EmbedSpot = 'page';
  private grab: EmbedGrabHandlers | null = null;
  private tracking: number | null = null;
  private flight: number | null = null;
  private unclaimedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Lifted out of its spot by hand, from this rect. */
  private liftRect: DOMRect | null = null;

  /** Whether this embed is loaded. */
  has(url: string): boolean {
    return this.url === url && !!this.frame;
  }

  /** Whether you've started the embed (tapped into it) since it loaded. */
  wasStarted(): boolean {
    return this.started && !!this.frame;
  }

  /** Counts it as started (sent to the miniplayer by hand). */
  markStarted(): void {
    if (this.frame) {
      this.started = true;
      if (this.label) {
        this.label.style.opacity = '0';
      }
      this.showControls();
    }
  }

  /** Another embed is showing somewhere (the miniplayer): this one would replace it. */
  busyElsewhere(url: string): boolean {
    return !!this.frame && this.url !== url && this.owner !== null;
  }

  isOwner(owner: object): boolean {
    return this.owner === owner;
  }

  /**
   * Shows the embed over `spot` for `owner`. Already loaded (handed over)
   * and waiting on screen, it flies there and this returns true; otherwise
   * it loads `url` there.
   */
  attach(
    owner: object,
    spot: HTMLElement,
    url: string,
    kind: EmbedSpot,
    grab: EmbedGrabHandlers | null = null,
    poster: string | null = null,
  ): boolean {
    this.clearUnclaimed();
    const carriesOn = this.has(url);
    this.owner = owner;
    this.spot = spot;
    this.spotKind = kind;
    this.grab = grab;
    this.liftRect = null;
    this.ensureLayer();
    if (!carriesOn) {
      this.load(url, poster);
      this.place(spot.getBoundingClientRect());
      this.settle();
      return false;
    }
    this.flyTo(spot, () => this.settle());
    return true;
  }

  /** Lets go of it, waiting on screen where it is, for the next spot to take. */
  park(owner: object, from: DOMRect | null): void {
    if (this.owner !== owner || !this.layer) {
      return;
    }
    this.owner = null;
    this.spot = null;
    this.grab = null;
    this.stopTracking();
    this.stopFlight();
    this.layer.style.zIndex = EmbedPlayerService.TOP_LAYER;
    this.layer.style.pointerEvents = 'none';
    this.showGrabStrip(false);
    if (from && from.width > 0) {
      this.place(from);
    }
    this.clearUnclaimed();
    this.unclaimedTimer = setTimeout(() => {
      this.unclaimedTimer = null;
      if (this.owner === null) {
        this.stop();
      }
    }, EmbedPlayerService.UNCLAIMED_MS);
  }

  /** Stops it (its owner is done). */
  release(owner: object): void {
    if (this.owner === owner) {
      this.stop();
    }
  }

  /** Lifts it out of its spot for a drag (or a page leaving): on top, where it is. */
  lift(owner?: object): boolean {
    if (!this.layer || !this.frame || !this.spot || (owner && this.owner !== owner)) {
      return false;
    }
    if (this.liftRect) {
      return true;
    }
    this.stopTracking();
    this.stopFlight();
    this.liftRect = this.layer.getBoundingClientRect();
    this.layer.style.zIndex = EmbedPlayerService.TOP_LAYER;
    this.layer.style.pointerEvents = 'none';
    this.showGrabStrip(false);
    return true;
  }

  isLifted(): boolean {
    return this.liftRect !== null;
  }

  /** Leaving a scene page that's showing it: lifted, so it stays on screen. */
  liftFromPage(): boolean {
    return this.spotKind === 'page' && this.owner !== null && this.lift();
  }

  /** Lifted, part of the way (0 to 1) to `target`. */
  moveLiftedTo(target: DOMRect, progress: number): void {
    const from = this.liftRect;
    if (!from) {
      return;
    }
    const t = Math.min(1, Math.max(0, progress));
    this.place(
      new DOMRect(
        from.left + (target.left - from.left) * t,
        from.top + (target.top - from.top) * t,
        from.width + (target.width - from.width) * t,
        from.height + (target.height - from.height) * t,
      ),
    );
  }

  /** A drag let go short: back into its spot. */
  dropBack(): void {
    const spot = this.spot;
    this.liftRect = null;
    if (spot) {
      // Its own page, already there: straight back, no waiting on it.
      this.flyTo(spot, () => this.settle(), false);
    }
  }

  /** The layer's place on screen now. */
  rect(): DOMRect | null {
    return this.layer?.getBoundingClientRect() ?? null;
  }

  private load(url: string, poster: string | null): void {
    if (!this.frame) {
      const frame = document.createElement('iframe');
      frame.title = 'Video';
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      frame.allowFullscreen = true;
      // Pornhub's player wants to know where it's shown.
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.style.cssText =
        'display:block;width:100%;height:100%;border:0;background:#000;transform-origin:0 0;opacity:0;transition:opacity 200ms ease-out;';
      // Shown once it has loaded: the scene's picture until then, not black.
      frame.addEventListener('load', () => (frame.style.opacity = '1'));
      this.layer!.insertBefore(frame, this.layer!.firstChild);
      this.frame = frame;
    }
    this.url = url;
    this.started = false;
    this.base = null;
    this.frame.style.opacity = '0';
    this.layer!.style.backgroundImage = poster ? `url("${poster.replace(/"/g, '%22')}")` : '';
    if (this.label) {
      this.label.style.opacity = '1';
    }
    this.frame.src = url;
    this.showControls();
  }

  /** Pornhub's controls (and the handle) show, for a while: its control bar uncovered. */
  private showControls(): void {
    this.controlsShown = true;
    if (this.handle) {
      this.handle.style.opacity = '1';
    }
    if (this.shield) {
      // Not started: nothing covers it (the first tap is Play).
      this.shield.style.pointerEvents = this.started ? 'auto' : 'none';
      this.shield.style.bottom = `${EmbedPlayerService.CONTROL_BAR_PX}px`;
    }
    this.openCorner(true);
    this.replace();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.handle) {
        this.handle.style.opacity = '0';
      }
      if (this.started) {
        this.hideControls();
      }
    }, EmbedPlayerService.IDLE_MS);
  }

  /** Left alone: Pornhub's title and controls cut off, the video all covered. */
  private hideControls(): void {
    this.controlsShown = false;
    if (this.shield) {
      this.shield.style.bottom = '0';
    }
    this.openCorner(false);
    this.replace();
  }

  /**
   * Leaves the top-right corner uncovered (or covers it again): a pop-up's
   * close button there can be tapped. Cut out of the strip and the shield
   * (a clipped-away part takes no touches).
   */
  private openCorner(open: boolean): void {
    const corner = EmbedPlayerService.OPEN_CORNER;
    const keep = `calc(100% - ${corner})`;
    if (this.grabStrip) {
      this.grabStrip.style.clipPath = open ? `inset(0 ${corner} 0 0)` : '';
    }
    if (this.shield) {
      this.shield.style.clipPath = open
        ? `polygon(0 0, ${keep} 0, ${keep} 50%, 100% 50%, 100% 100%, 0 100%)`
        : '';
    }
  }

  /** Placed again where it is (its layout changed). */
  private replace(): void {
    if (this.layer && this.layer.style.visibility !== 'hidden') {
      this.place(this.layer.getBoundingClientRect());
    }
  }

  /** Focus gone into the embed: you've tapped it (Play), so it's started. */
  private noticeStart(): void {
    // The focus moves after the blur.
    setTimeout(() => {
      if (!this.frame || this.started || document.activeElement !== this.frame) {
        return;
      }
      this.started = true;
      if (this.label) {
        this.label.style.opacity = '0';
      }
      this.showControls();
      this.grab?.started?.();
    });
  }

  private showGrabStrip(shown: boolean): void {
    if (this.grabStrip) {
      this.grabStrip.style.display = shown ? 'flex' : 'none';
    }
    if (this.shield) {
      this.shield.style.display = shown ? 'block' : 'none';
    }
  }

  private ensureLayer(): void {
    if (this.layer?.isConnected) {
      return;
    }
    const layer = document.createElement('div');
    layer.className = 'embed-layer';
    layer.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;background:#000 center/cover no-repeat;visibility:hidden;';
    const strip = document.createElement('div');
    strip.className = 'embed-grab';
    strip.setAttribute('aria-hidden', 'true');
    strip.style.cssText = `position:absolute;left:0;right:0;top:0;height:${EmbedPlayerService.GRAB_STRIP_PX}px;z-index:1;touch-action:none;display:flex;justify-content:center;padding-top:8px;box-sizing:border-box;`;
    const handle = document.createElement('span');
    handle.style.cssText =
      'width:36px;height:4px;border-radius:2px;background:rgb(255 255 255 / 70%);box-shadow:0 1px 3px rgb(0 0 0 / 50%);transition:opacity 300ms;';
    strip.appendChild(handle);
    this.handle = handle;
    // Where it plays from, until you start it.
    const label = document.createElement('span');
    label.textContent = 'Streams from Pornhub';
    label.style.cssText =
      'position:absolute;left:10px;top:10px;max-width:calc(50% - 30px);padding:4px 10px;border-radius:6px;background:rgb(0 0 0 / 60%);color:#fff;font-size:0.75rem;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;transition:opacity 300ms;';
    strip.appendChild(label);
    this.label = label;
    strip.addEventListener('touchstart', (event) => this.grab?.start(event), { passive: true });
    claimSwipesDown(strip);
    strip.addEventListener('click', () => this.showControls());
    layer.appendChild(strip);
    // The rest of the player, on a touch screen (see the class comment).
    const shield = document.createElement('div');
    shield.className = 'embed-shield';
    shield.setAttribute('aria-hidden', 'true');
    shield.style.cssText = `position:absolute;left:0;right:0;top:${EmbedPlayerService.GRAB_STRIP_PX}px;bottom:0;z-index:1;touch-action:pan-y;pointer-events:none;cursor:pointer;`;
    shield.addEventListener('touchstart', (event) => this.grab?.start(event), { passive: true });
    claimSwipesDown(shield);
    // A tap (not a drag): the controls show.
    shield.addEventListener('click', () => this.showControls());
    layer.appendChild(shield);
    this.shield = shield;
    if (this.frame) {
      layer.appendChild(this.frame);
    }
    document.body.appendChild(layer);
    if (!this.layer) {
      window.addEventListener('blur', () => this.noticeStart());
    }
    this.layer = layer;
    this.grabStrip = strip;
  }

  /** In its spot: follows it, at its layer, taking touches or not. */
  private settle(): void {
    if (!this.layer) {
      return;
    }
    const inPage = this.spotKind === 'page';
    this.layer.style.zIndex = inPage
      ? EmbedPlayerService.PAGE_LAYER
      : EmbedPlayerService.MINI_LAYER;
    this.layer.style.pointerEvents = inPage ? 'auto' : 'none';
    this.showGrabStrip(inPage);
    this.startTracking();
  }

  private startTracking(): void {
    this.stopTracking();
    const follow = () => {
      const spot = this.spot;
      if (!spot || !this.layer) {
        this.tracking = null;
        return;
      }
      const rect = spot.getBoundingClientRect();
      if (!spot.isConnected || rect.width <= 0) {
        // Its page isn't on screen (asleep): out of sight, still playing.
        this.layer.style.visibility = 'hidden';
      } else {
        if (this.spotKind === 'page') {
          // Laid out at the page player's size (scaled from it elsewhere).
          this.base = { width: rect.width, height: rect.height };
        }
        this.place(rect);
        // On the page: only the part not under the top bar.
        const top = this.spotKind === 'page' ? Math.max(0, topBarBottom() - rect.top) : 0;
        this.layer.style.clipPath = top > 0 ? `inset(${top}px 0 0 0)` : '';
      }
      this.tracking = requestAnimationFrame(follow);
    };
    this.tracking = requestAnimationFrame(follow);
  }

  private stopTracking(): void {
    if (this.tracking !== null) {
      cancelAnimationFrame(this.tracking);
      this.tracking = null;
    }
  }

  private flyTo(spot: HTMLElement, land: () => void, waitForPage = true): void {
    this.stopTracking();
    this.stopFlight();
    if (!this.layer) {
      return;
    }
    this.layer.style.zIndex = EmbedPlayerService.TOP_LAYER;
    this.layer.style.pointerEvents = 'none';
    this.layer.style.clipPath = '';
    this.showGrabStrip(false);
    const from = this.layer.getBoundingClientRect();
    let start: number | null = null;
    let waitingSince: number | null = null;
    const step = (now: number) => {
      if (!spot.isConnected) {
        this.flight = null;
        land();
        return;
      }
      // Its page still loading (hidden) or the one before still leaving: wait.
      if (
        waitForPage &&
        start === null &&
        (spot.closest('.is-pending') || pageStillLeaving(spot))
      ) {
        waitingSince ??= now;
        if (now - waitingSince < EmbedPlayerService.WAIT_FOR_PAGE_MS) {
          this.flight = requestAnimationFrame(step);
          return;
        }
      }
      start ??= now;
      const t = Math.min(1, (now - start) / EmbedPlayerService.FLIGHT_MS);
      const e = 1 - Math.pow(1 - t, 3);
      const to = spot.getBoundingClientRect();
      this.place(
        new DOMRect(
          from.left + (to.left - from.left) * e,
          from.top + (to.top - from.top) * e,
          from.width + (to.width - from.width) * e,
          from.height + (to.height - from.height) * e,
        ),
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

  private place(rect: DOMRect): void {
    if (!this.layer) {
      return;
    }
    Object.assign(this.layer.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      visibility: 'visible',
    });
    // The embed at its own size, scaled to this; with its controls hidden,
    // taller (the video staying put), its title and control bar cut off.
    const frame = this.frame;
    if (frame) {
      const base = this.base ?? { width: rect.width, height: rect.height };
      this.base = base;
      const cropped = !this.controlsShown || this.spotKind !== 'page' || this.liftRect !== null;
      const pad = cropped ? EmbedPlayerService.CROP_PX : 0;
      const scaleX = base.width > 0 ? rect.width / base.width : 1;
      const scaleY = base.height > 0 ? rect.height / base.height : scaleX;
      frame.style.width = `${base.width}px`;
      frame.style.height = `${base.height + pad * 2}px`;
      const unscaled = Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001;
      frame.style.transform =
        unscaled && pad === 0 ? '' : `translateY(${-pad * scaleY}px) scale(${scaleX}, ${scaleY})`;
    }
  }

  private stop(): void {
    this.owner = null;
    this.spot = null;
    this.grab = null;
    this.liftRect = null;
    this.url = null;
    this.started = false;
    this.base = null;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.stopTracking();
    this.stopFlight();
    this.clearUnclaimed();
    if (this.frame) {
      this.frame.remove();
      this.frame = null;
    }
    if (this.layer) {
      this.layer.style.visibility = 'hidden';
      this.layer.style.backgroundImage = '';
      this.layer.style.width = '0';
      this.layer.style.height = '0';
    }
  }

  private clearUnclaimed(): void {
    if (this.unclaimedTimer) {
      clearTimeout(this.unclaimedTimer);
      this.unclaimedTimer = null;
    }
  }
}

/** The bottom of the top bar on screen (0 when it's hidden or absent). */
function topBarBottom(): number {
  const masthead = document.querySelector<HTMLElement>('.masthead');
  if (!masthead) {
    return 0;
  }
  const rect = masthead.getBoundingClientRect();
  return rect.bottom > 0 && getComputedStyle(masthead).visibility !== 'hidden' ? rect.bottom : 0;
}

/** Another page is still in the page area alongside the spot's (leaving). */
function pageStillLeaving(spot: HTMLElement): boolean {
  const area = spot.closest('.route-view');
  // (Not a page only put behind this one: readied for a swipe, it stays.)
  return (
    !!area && area.querySelectorAll(':scope > :not(router-outlet):not(.page-behind)').length > 1
  );
}

/**
 * A swipe down on the player is claimed from its first move: left to the
 * browser even briefly, Safari starts bouncing the whole page with the
 * finger (a black gap opening above it) and won't give the swipe back. On
 * the element itself (not added once the touch has begun), so Safari knows
 * from the start that its moves may be taken.
 */
function claimSwipesDown(element: HTMLElement): void {
  let from: { x: number; y: number } | null = null;
  let claimed: boolean | null = null;
  element.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      from = touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
      claimed = null;
    },
    { passive: true },
  );
  element.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (!from || !touch || claimed === false || !event.cancelable) {
        return;
      }
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      claimed ??= dy > 0 && dy >= Math.abs(dx);
      if (claimed) {
        event.preventDefault();
      }
    },
    { passive: false },
  );
}
