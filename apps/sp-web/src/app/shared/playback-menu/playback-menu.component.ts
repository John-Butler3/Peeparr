import { Component, ElementRef, HostListener, Input, inject, signal } from '@angular/core';
import { PlayerService } from '../../core/player/player.service';
import { SharedVideoService } from '../../core/player/shared-video.service';
import {
  VIDEO_QUALITIES,
  VideoQuality,
  VideoQualityService,
} from '../../core/player/video-quality.service';

/**
 * The scene page's playback settings, behind one round button beside the
 * title: the video quality (this device's; a scene playing switches to it
 * from where it is) and picture-in-picture (once the scene's video has
 * loaded). Opens in the page, just below the button.
 */
@Component({
  selector: 'app-playback-menu',
  templateUrl: './playback-menu.component.html',
  styleUrl: './playback-menu.component.scss',
})
export class PlaybackMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly videoQuality = inject(VideoQualityService);
  protected readonly sharedVideo = inject(SharedVideoService);
  protected readonly qualities = VIDEO_QUALITIES;
  private readonly playerService = inject(PlayerService);
  /**
   * Added to an iPhone's home screen: iOS doesn't do picture-in-picture
   * there (only in Safari), so it's done by carrying on in Safari.
   */
  protected readonly homeScreenIphone = isHomeScreenIphone();
  protected readonly pipSupported =
    !this.homeScreenIphone && this.sharedVideo.pictureInPictureSupported();
  protected readonly open = signal(false);

  /** The Stash scenes this page plays (picture-in-picture once one has loaded). */
  @Input() sceneIds: readonly string[] = [];

  /** This scene's original quality, e.g. "1080p" (asked for once, on opening). */
  protected readonly originalLabel = signal<string | null>(null);
  private askedOriginal = false;

  protected toggle(): void {
    this.open.update((open) => !open);
    const scene = this.sceneIds[0];
    if (this.open() && scene && !this.askedOriginal) {
      this.askedOriginal = true;
      this.playerService
        .originalHeight(scene)
        .subscribe((height) => this.originalLabel.set(height ? heightLabel(height) : null));
    }
  }

  protected choose(quality: VideoQuality): void {
    this.videoQuality.set(quality);
    this.open.set(false);
  }

  protected loaded(): boolean {
    const scene = this.sharedVideo.loadedScene();
    return scene !== null && this.sceneIds.includes(scene);
  }

  protected pictureInPicture(): void {
    this.open.set(false);
    this.sharedVideo.enterPictureInPicture();
  }

  /**
   * Carries on in Safari (where picture-in-picture works): where it is
   * saved, it's paused here, and this page opens in Safari (iOS 17's
   * x-safari- links), picking up from there.
   */
  protected continueInSafari(): void {
    this.open.set(false);
    const video = this.sharedVideo.video;
    const scene = this.sharedVideo.loadedScene();
    if (scene && this.loaded() && video.currentTime > 0) {
      this.playerService.saveProgressOnLeaving(
        scene,
        video.currentTime,
        Number.isFinite(video.duration) ? video.duration : null,
      );
      video.pause();
    }
    const url = new URL(location.href);
    url.searchParams.set('autoplay', '1');
    location.href = `x-safari-${url.toString()}`;
  }

  protected qualityLabel(): string {
    return (
      VIDEO_QUALITIES.find((option) => option.value === this.videoQuality.quality())?.label ??
      'Original'
    );
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}

function isHomeScreenIphone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** A height as a quality: 1080 -> "1080p", 2160 -> "4K". */
function heightLabel(height: number): string {
  if (height >= 2000) {
    return '4K';
  }
  return `${height}p`;
}
