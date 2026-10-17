import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { PageFadeService } from '../navigation/page-fade.service';
import { EmbedPlayerService } from '../player/embed-player.service';
import { SharedVideoService } from '../player/shared-video.service';

/**
 * Leaving a scene page while its video plays: the video is lifted out of
 * the page (staying where it is on screen) and the page fades out under it,
 * then the page change goes ahead and the video flies down into the
 * miniplayer. Never blocks leaving.
 */
export const fadeOutUnderMovingVideoGuard: CanDeactivateFn<unknown> = async () => {
  const sharedVideo = inject(SharedVideoService);
  const embedPlayer = inject(EmbedPlayerService);
  const pageFade = inject(PageFadeService);
  // Already lifted by a swipe down, or lifted now (Stash's video, or a
  // stream from Pornhub).
  if (
    sharedVideo.isLifted() ||
    sharedVideo.liftIfPlaying() ||
    embedPlayer.isLifted() ||
    embedPlayer.liftFromPage()
  ) {
    await pageFade.fadeOut();
  }
  return true;
};
