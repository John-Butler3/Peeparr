import { Component, inject } from '@angular/core';
import {
  VIDEO_QUALITIES,
  VideoQuality,
  VideoQualityService,
} from '../../core/player/video-quality.service';

/**
 * The scene page's quality choice (this device's): a pill opening the
 * phone's own picker. A scene playing switches to it from where it is.
 * Not shown where the lower qualities can't play (no HLS).
 */
@Component({
  selector: 'app-quality-pill',
  template: `
    @if (videoQuality.available) {
      <label class="pill quality-pill" title="Video quality on this device">
        <i class="pi pi-sliders-h" aria-hidden="true"></i>
        <span>{{ label() }}</span>
        <select
          aria-label="Video quality"
          [value]="videoQuality.quality()"
          (change)="choose($any($event.target).value)"
        >
          @for (option of options; track option.value) {
            <option [value]="option.value" [selected]="option.value === videoQuality.quality()">
              {{ option.label }}
            </option>
          }
        </select>
      </label>
    }
  `,
  styles: `
    .quality-pill {
      position: relative;
      cursor: pointer;
    }
    /* The phone's own picker, over the whole pill (unseen). */
    select {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
      font-size: 16px;
    }
  `,
})
export class QualityPillComponent {
  protected readonly videoQuality = inject(VideoQualityService);
  protected readonly options = VIDEO_QUALITIES;

  protected label(): string {
    return (
      VIDEO_QUALITIES.find((option) => option.value === this.videoQuality.quality())?.label ??
      'Original'
    );
  }

  protected choose(value: string): void {
    this.videoQuality.set(value as VideoQuality);
  }
}
