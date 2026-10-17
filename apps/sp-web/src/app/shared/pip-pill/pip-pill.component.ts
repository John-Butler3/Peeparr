import { Component, Input, inject } from '@angular/core';
import { SharedVideoService } from '../../core/player/shared-video.service';

/**
 * Picture-in-picture for the scene playing on this page: the video floats
 * in its own window, carrying on when you leave the app. Shown once the
 * scene's video has loaded, where the browser can do it.
 */
@Component({
  selector: 'app-pip-pill',
  template: `
    @if (shown()) {
      <button
        type="button"
        class="pill"
        title="Keep watching in a floating window, outside the app too"
        (click)="sharedVideo.enterPictureInPicture()"
      >
        <i class="pi pi-clone" aria-hidden="true"></i> Picture in picture
      </button>
    }
  `,
})
export class PipPillComponent {
  protected readonly sharedVideo = inject(SharedVideoService);
  private readonly supported = this.sharedVideo.pictureInPictureSupported();

  /** The Stash scenes this page plays (one of them loaded: shown). */
  @Input() sceneIds: readonly string[] = [];

  protected shown(): boolean {
    const loaded = this.sharedVideo.loadedScene();
    return this.supported && loaded !== null && this.sceneIds.includes(loaded);
  }
}
