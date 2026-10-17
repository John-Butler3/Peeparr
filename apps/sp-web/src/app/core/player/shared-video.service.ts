import { Injectable } from '@angular/core';

/**
 * The one <video> element a scene plays in, wherever it's shown: the scene
 * page's player and the miniplayer take turns hosting it (it's moved, not
 * recreated). A new element would end an AirPlay session (and restart
 * buffering); the same element carries on, on the Apple TV too.
 *
 * Between hosts (leaving the page, before the miniplayer appears) it waits
 * in a hidden holder that's always in the page: a video taken out of the
 * page pauses.
 */
@Injectable({ providedIn: 'root' })
export class SharedVideoService {
  private element: HTMLVideoElement | null = null;
  private holder: HTMLElement | null = null;
  private owner: object | null = null;
  /** The Stash scene loaded into it. */
  private sceneId: string | null = null;

  get video(): HTMLVideoElement {
    if (!this.element) {
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      video.setAttribute('x-webkit-airplay', 'allow');
      this.element = video;
    }
    return this.element;
  }

  /**
   * Shows the video in `slot` for `owner`. With that scene already loaded
   * (handed over from the other player) it carries on as it is and this
   * returns true; otherwise it loads `src` and returns false.
   */
  attach(owner: object, slot: HTMLElement, sceneId: string, src: string): boolean {
    const video = this.video;
    this.owner = owner;
    if (video.parentElement !== slot) {
      slot.appendChild(video);
    }
    if (this.sceneId === sceneId && video.getAttribute('src') && !video.ended) {
      return true;
    }
    this.sceneId = sceneId;
    video.src = src;
    return false;
  }

  isOwner(owner: object): boolean {
    return this.owner === owner;
  }

  /** Whether this scene is loaded and playing (worth handing over). */
  isPlaying(sceneId: string): boolean {
    const video = this.element;
    return !!video && this.sceneId === sceneId && !video.paused && !video.ended;
  }

  /** Keeps it playing, in the hidden holder, until the next player takes it. */
  park(owner: object): void {
    if (this.owner !== owner || !this.element) {
      return;
    }
    this.owner = null;
    this.parkingSpot().appendChild(this.element);
  }

  /** Stops it: its player is done with it. */
  release(owner: object): void {
    const video = this.element;
    if (this.owner !== owner || !video) {
      return;
    }
    this.owner = null;
    this.sceneId = null;
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    try {
      video.load();
    } catch {
      // Not implemented everywhere (tests); the source is gone either way.
    }
    this.parkingSpot().appendChild(video);
  }

  private parkingSpot(): HTMLElement {
    if (!this.holder || !this.holder.isConnected) {
      const holder = document.createElement('div');
      holder.setAttribute('aria-hidden', 'true');
      // In the page (so it keeps playing) but out of sight. Not display:none:
      // that can stop a video's picture updating.
      holder.style.cssText =
        'position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
      document.body.appendChild(holder);
      this.holder = holder;
    }
    return this.holder;
  }
}
