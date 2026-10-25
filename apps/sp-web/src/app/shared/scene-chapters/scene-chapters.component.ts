import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { SceneMarker } from '../../core/api/discover.types';
import { SharedVideoService } from '../../core/player/shared-video.service';

/**
 * A scene's chapters (its markers, from Stash or ThePornDB) under its
 * player: a row of neat chips, time then name; the one playing now is
 * lit, and kept in view in the row. Tapping one plays from there.
 */
@Component({
  selector: 'app-scene-chapters',
  templateUrl: './scene-chapters.component.html',
  styleUrl: './scene-chapters.component.scss',
})
export class SceneChaptersComponent implements OnDestroy {
  private readonly sharedVideo = inject(SharedVideoService);
  private listeners: AbortController | null = null;

  private readonly markerList = signal<SceneMarker[]>([]);
  private readonly ids = signal<readonly string[]>([]);
  private readonly time = signal<number | null>(null);

  /** Its markers, any order, maybe repeated. */
  @Input() set markers(value: readonly SceneMarker[] | null | undefined) {
    this.markerList.set(tidyMarkers(value ?? []));
  }

  /** The library scenes it is (its copies): followed while one of them plays. */
  @Input() set sceneIds(value: readonly string[]) {
    this.ids.set(value);
  }

  /** Play from this moment (seconds). */
  @Output() readonly seek = new EventEmitter<number>();

  @ViewChild('row') private row?: ElementRef<HTMLElement>;

  protected readonly chapters = computed(() => this.markerList());

  /** The chapter playing now (the last one started), if it's this scene playing. */
  protected readonly current = computed(() => {
    const time = this.time();
    if (time === null) {
      return -1;
    }
    let index = -1;
    this.markerList().forEach((marker, i) => {
      if (marker.seconds <= time + 0.25) {
        index = i;
      }
    });
    return index;
  });

  // Follows the shared video while it's this scene.
  private readonly follow = effect(() => {
    const loaded = this.sharedVideo.loadedScene();
    const ours = loaded !== null && this.ids().includes(loaded);
    this.listeners?.abort();
    this.listeners = null;
    if (!ours) {
      this.time.set(null);
      return;
    }
    const video = this.sharedVideo.video;
    this.listeners = new AbortController();
    const update = () => this.time.set(video.currentTime);
    video.addEventListener('timeupdate', update, { signal: this.listeners.signal });
    video.addEventListener('seeked', update, { signal: this.listeners.signal });
    update();
  });

  // The playing chapter kept in view in the row (the page itself isn't scrolled).
  private readonly keepInView = effect(() => {
    const index = this.current();
    const row = this.row?.nativeElement;
    const chip = index >= 0 ? (row?.children.item(index) as HTMLElement | null) : null;
    if (!row || !chip) {
      return;
    }
    const left = chip.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' });
    }
  });

  ngOnDestroy(): void {
    this.listeners?.abort();
  }

  protected label(seconds: number): string {
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
      : `${minutes}:${rest}`;
  }
}

/** In order; the same name at (about) the same moment once; at most 80. */
export function tidyMarkers(markers: readonly SceneMarker[]): SceneMarker[] {
  const sorted = markers
    .filter(
      (marker) => Number.isFinite(marker.seconds) && marker.seconds >= 0 && marker.title?.trim(),
    )
    .map((marker) => ({ seconds: marker.seconds, title: marker.title.trim() }))
    .sort((a, b) => a.seconds - b.seconds);
  const kept: SceneMarker[] = [];
  for (const marker of sorted) {
    const repeat = kept.some(
      (other) =>
        Math.abs(other.seconds - marker.seconds) < 3 &&
        other.title.toLowerCase() === marker.title.toLowerCase(),
    );
    if (!repeat) {
      kept.push(marker);
    }
  }
  return kept.slice(0, 80);
}
