import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ScenePlaybackSource } from '../api/discover.types';

/** The quality scenes play at: the original file, or a lower one Stash converts to as it's watched. */
export type VideoQuality = 'ORIGINAL' | 'FULL_HD' | 'STANDARD_HD' | 'STANDARD' | 'LOW';

export const VIDEO_QUALITIES: ReadonlyArray<{ value: VideoQuality; label: string }> = [
  { value: 'ORIGINAL', label: 'Original' },
  { value: 'FULL_HD', label: '1080p' },
  { value: 'STANDARD_HD', label: '720p' },
  { value: 'STANDARD', label: '480p' },
  { value: 'LOW', label: '240p' },
];

/**
 * The quality library scenes play at, on this device. Original plays the
 * file as it is; a lower one plays Stash's HLS conversion of it (made as
 * it's watched: easier on a slow connection, harder on Stash's CPU), which
 * Safari plays natively -- elsewhere, without HLS, it's always the original.
 */
@Injectable({ providedIn: 'root' })
export class VideoQualityService {
  private static readonly STORAGE_KEY = 'peeparr.videoQuality';

  readonly quality = signal<VideoQuality>(VideoQualityService.stored());
  /** Changed by hand (a player playing switches to it). */
  readonly changes = new Subject<VideoQuality>();

  /** Whether this browser can play the lower qualities (HLS). */
  readonly available = canPlayHls();

  set(quality: VideoQuality): void {
    if (quality === this.quality()) {
      return;
    }
    this.quality.set(quality);
    try {
      localStorage.setItem(VideoQualityService.STORAGE_KEY, quality);
    } catch {
      // Private browsing: just for now.
    }
    this.changes.next(quality);
  }

  /** The source at this device's quality (its stream address swapped for the HLS one). */
  apply(source: ScenePlaybackSource): ScenePlaybackSource {
    const quality = this.quality();
    if (quality === 'ORIGINAL' || !this.available || source.embedUrl) {
      return source;
    }
    // /api/media/stash/scenes/<id>/stream[?st=...] -> .../hls/<quality>.m3u8[?st=...]
    const streamUrl = source.streamUrl.replace(
      /\/api\/media\/stash\/scenes\/([^/?]+)\/stream(?=$|\?)/,
      `/api/media/stash/scenes/$1/hls/${quality}.m3u8`,
    );
    return { ...source, streamUrl };
  }

  private static stored(): VideoQuality {
    try {
      const value = localStorage.getItem(VideoQualityService.STORAGE_KEY);
      return VIDEO_QUALITIES.some((option) => option.value === value)
        ? (value as VideoQuality)
        : 'ORIGINAL';
    } catch {
      return 'ORIGINAL';
    }
  }
}

function canPlayHls(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
}
