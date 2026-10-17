import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { PageFadeService } from '../navigation/page-fade.service';
import { SharedVideoService } from '../player/shared-video.service';

/**
 * Leaving a scene page while its video plays: the video is lifted out of
 * the page (staying where it is on screen) and the page fades out under it,
 * then the page change goes ahead and the video flies down into the
 * miniplayer. Never blocks leaving.
 */
export const fadeOutUnderMovingVideoGuard: CanDeactivateFn<unknown> = async () => {
  const sharedVideo = inject(SharedVideoService);
  const pageFade = inject(PageFadeService);
  if (sharedVideo.liftIfPlaying()) {
    await pageFade.fadeOut();
  }
  return true;
};
