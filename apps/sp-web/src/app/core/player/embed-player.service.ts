import { Injectable } from '@angular/core';

/** Where the embed is being shown, and how it behaves there. */
export type EmbedSpot = 'page' | 'mini';

/** A drag on the grab strip (scene page only): its phases, for the owner. */
export interface EmbedGrabHandlers {
  start(event: TouchEvent): void;
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

  private layer: HTMLElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private grabStrip: HTMLElement | null = null;
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

  /** Whether this embed is loaded (playing, as far as we can tell). */
  has(url: string): boolean {
    return this.url === url && !!this.frame;
  }

  isOwner(owner: object): boolean {
    return this.owner === owner;
  }

  /**
   * Shows the embed over `spot` for `owner`. Already loaded (handed over)
   * and waiting on screen, it flies there; otherwise it loads `url` there.
   */
  attach(
    owner: object,
    spot: HTMLElement,
    url: string,
    kind: EmbedSpot,
    grab: EmbedGrabHandlers | null = null,
  ): void {
    this.clearUnclaimed();
    const carriesOn = this.has(url);
    this.owner = owner;
    this.spot = spot;
    this.spotKind = kind;
    this.grab = grab;
    this.liftRect = null;
    this.ensureLayer();
    if (!carriesOn) {
      this.load(url);
      this.place(spot.getBoundingClientRect());
      this.settle();
      return;
    }
    this.flyTo(spot, () => this.settle());
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
      this.flyTo(spot, () => this.settle());
    }
  }

  /** The layer's place on screen now. */
  rect(): DOMRect | null {
    return this.layer?.getBoundingClientRect() ?? null;
  }

  private load(url: string): void {
    if (!this.frame) {
      const frame = document.createElement('iframe');
      frame.title = 'Video';
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      frame.allowFullscreen = true;
      // Pornhub's player wants to know where it's shown.
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#000;';
      this.layer!.appendChild(frame);
      this.frame = frame;
    }
    this.url = url;
    this.frame.src = url;
  }

  private ensureLayer(): void {
    if (this.layer?.isConnected) {
      return;
    }
    const layer = document.createElement('div');
    layer.className = 'embed-layer';
    layer.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;background:#000;visibility:hidden;';
    const strip = document.createElement('div');
    strip.className = 'embed-grab';
    strip.setAttribute('aria-hidden', 'true');
    strip.style.cssText = `position:absolute;left:0;right:0;top:0;height:${EmbedPlayerService.GRAB_STRIP_PX}px;z-index:1;touch-action:none;display:flex;justify-content:center;padding-top:8px;box-sizing:border-box;`;
    const handle = document.createElement('span');
    handle.style.cssText =
      'width:36px;height:4px;border-radius:2px;background:rgb(255 255 255 / 70%);box-shadow:0 1px 3px rgb(0 0 0 / 50%);';
    strip.appendChild(handle);
    strip.addEventListener('touchstart', (event) => this.grab?.start(event), { passive: true });
    layer.appendChild(strip);
    if (this.frame) {
      layer.appendChild(this.frame);
    }
    document.body.appendChild(layer);
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
    if (this.grabStrip) {
      this.grabStrip.style.display = inPage ? 'flex' : 'none';
    }
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

  private flyTo(spot: HTMLElement, land: () => void): void {
    this.stopTracking();
    this.stopFlight();
    if (!this.layer) {
      return;
    }
    this.layer.style.zIndex = EmbedPlayerService.TOP_LAYER;
    this.layer.style.pointerEvents = 'none';
    this.layer.style.clipPath = '';
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
      if (start === null && (spot.closest('.is-pending') || pageStillLeaving(spot))) {
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
  }

  private stop(): void {
    this.owner = null;
    this.spot = null;
    this.grab = null;
    this.liftRect = null;
    this.url = null;
    this.stopTracking();
    this.stopFlight();
    this.clearUnclaimed();
    if (this.frame) {
      this.frame.remove();
      this.frame = null;
    }
    if (this.layer) {
      this.layer.style.visibility = 'hidden';
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
  return !!area && area.querySelectorAll(':scope > :not(router-outlet)').length > 1;
}
