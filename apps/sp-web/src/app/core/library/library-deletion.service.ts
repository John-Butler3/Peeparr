import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, RouteReuseStrategy, Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { filter, take } from 'rxjs';
import { KeepAliveRouteStrategy } from '../navigation/keep-alive-route.strategy';
import { NavigationHistoryService } from '../navigation/navigation-history.service';
import { AppNotificationsService } from '../notifications/app-notifications.service';
import { PlayerService } from '../player/player.service';
import { SharedVideoService } from '../player/shared-video.service';

interface DeleteLibrarySceneResponse {
  deletedStashSceneIds: string[];
  removedFromWhisparr: boolean;
}

/**
 * Deleting a scene from the library for good, from its page: asked first,
 * then Stash deletes its files and Whisparr forgets it (not to download it
 * again); playing, it stops; and its page is left (and not kept to come
 * back to).
 */
@Injectable({ providedIn: 'root' })
export class LibraryDeletionService {
  private readonly http = inject(HttpClient);
  private readonly confirmation = inject(ConfirmationService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly playerService = inject(PlayerService);
  private readonly sharedVideo = inject(SharedVideoService);
  private readonly history = inject(NavigationHistoryService);
  private readonly router = inject(Router);
  private readonly reuseStrategy = inject(RouteReuseStrategy);

  /** Asks, then deletes; `busy` follows the request. */
  confirmDelete(scene: {
    title: string;
    stashSceneIds: readonly string[];
    catalogSceneId: string | null;
    busy?: (busy: boolean) => void;
  }): void {
    const copies =
      scene.stashSceneIds.length > 1 ? ` (all ${scene.stashSceneIds.length} copies)` : '';
    this.confirmation.confirm({
      key: 'app-destructive',
      header: 'Delete from your library?',
      message:
        `Delete "${scene.title}"${copies}? Its video file is deleted from your library (Stash), ` +
        "and it's removed from Whisparr, which won't download it again. This can't be undone.",
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.delete(scene),
    });
  }

  private delete(scene: {
    stashSceneIds: readonly string[];
    catalogSceneId: string | null;
    busy?: (busy: boolean) => void;
  }): void {
    scene.busy?.(true);
    const pageUrl = this.router.url;
    this.http
      .post<DeleteLibrarySceneResponse>('/api/library/delete-scene', {
        stashSceneIds: scene.stashSceneIds,
        catalogSceneId: scene.catalogSceneId,
        keepAway: true,
      })
      .subscribe({
        next: (result) => {
          scene.busy?.(false);
          // Not carried on into the miniplayer: it's gone.
          this.sharedVideo.stopScene(scene.stashSceneIds);
          this.playerService.close();
          this.notifications.success(
            result.removedFromWhisparr
              ? 'Deleted from your library and Whisparr'
              : 'Deleted from your library',
          );
          this.leave(pageUrl);
        },
        error: (error: { error?: { message?: string } }) => {
          scene.busy?.(false);
          this.notifications.error(error.error?.message ?? "Couldn't delete it. Please try again.");
        },
      });
  }

  /** Off the deleted scene's page, which isn't kept to come back to. */
  private leave(pageUrl: string): void {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        take(1),
      )
      .subscribe(() => {
        if (this.reuseStrategy instanceof KeepAliveRouteStrategy) {
          this.reuseStrategy.forget(pageUrl);
        }
      });
    if (!this.history.back()) {
      void this.router.navigate(['/library']);
    }
  }
}
