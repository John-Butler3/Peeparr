import { Component, OnDestroy, OnInit, computed, inject, signal, effect } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Subscription, catchError, of } from 'rxjs';
import { GroupsService } from '../../core/api/groups.service';
import { SceneSeriesMembership } from '../../core/api/groups.types';
import { LibraryService } from '../../core/api/library.service';
import { LibrarySceneDetail } from '../../core/api/library.types';
import {
  libraryScenePlayerDetails,
  libraryUpNextItem,
  mergeUpNext,
  seriesUpNextItems,
} from '../../core/player/player-details.util';
import { PlayerDetails } from '../../core/player/player.service';
import { WatchProgressService } from '../../core/player/watch-progress.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { InlinePlayerComponent } from '../../shared/inline-player/inline-player.component';
import { UpNextItem, UpNextListComponent } from '../../shared/up-next-list/up-next-list.component';
import { AddToSeriesDialogComponent } from '../../shared/add-to-series-dialog/add-to-series-dialog.component';
import { NavigationHistoryService } from '../../core/navigation/navigation-history.service';

// Scene page for a library scene with no catalog match ("Local only"): built
// from the local library index, with a link out to the scene in Stash.
// Scenes that do match the catalog use the regular /scene/:stashId page.
import { QualityPillComponent } from '../../shared/quality-pill/quality-pill.component';
@Component({
  selector: 'app-local-scene-page',
  imports: [
    QualityPillComponent,
    RouterLink,
    Message,
    ProgressSpinner,
    AddToSeriesDialogComponent,
    InlinePlayerComponent,
    UpNextListComponent,
  ],
  templateUrl: './local-scene-page.component.html',
  styleUrl: './local-scene-page.component.scss',
})
export class LocalScenePageComponent implements OnInit, OnDestroy {
  private static readonly DESCRIPTION_PREVIEW_LENGTH = 420;

  private readonly libraryService = inject(LibraryService);
  private readonly groupsService = inject(GroupsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(AppNotificationsService);
  protected readonly watchProgress = inject(WatchProgressService);
  protected readonly markingUnwatched = signal(false);
  private paramSubscription: Subscription | null = null;
  private loadSubscription: Subscription | null = null;
  private seriesSubscription: Subscription | null = null;
  private upNextSubscription: Subscription | null = null;

  protected readonly scene = signal<LibrarySceneDetail | null>(null);
  protected readonly navigationHistory = inject(NavigationHistoryService);
  // Names this screen for the next one's "Back to ..." button.
  private readonly nameForBackButton = effect(() => this.navigationHistory.setLabel(this.scene()?.title));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly series = signal<SceneSeriesMembership[]>([]);
  protected readonly seriesDialogOpen = signal(false);
  protected readonly descriptionExpanded = signal(false);
  private readonly recommendedUpNext = signal<UpNextItem[]>([]);
  // The following parts when this scene is in a series.
  private readonly seriesUpNext = signal<UpNextItem[]>([]);
  private seriesUpNextSubscription: Subscription | null = null;
  private currentSceneId: string | null = null;
  protected readonly upNext = computed(() =>
    mergeUpNext(this.seriesUpNext(), this.recommendedUpNext()),
  );
  protected readonly upNextLoading = signal(false);
  protected readonly autoplay = signal(false);

  ngOnInit(): void {
    this.paramSubscription = this.route.paramMap.subscribe((params) => {
      this.autoplay.set(this.route.snapshot.queryParamMap.get('autoplay') === '1');
      this.load(params.get('sceneId') ?? '');
    });
  }

  ngOnDestroy(): void {
    this.paramSubscription?.unsubscribe();
    this.loadSubscription?.unsubscribe();
    this.seriesSubscription?.unsubscribe();
    this.upNextSubscription?.unsubscribe();
    this.seriesUpNextSubscription?.unsubscribe();
  }

  protected retry(): void {
    this.load(this.route.snapshot.paramMap.get('sceneId') ?? '');
  }

  // Where "Back" goes: the page that linked here (returnTo), else the library.
  protected backLink(): string {
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo') ?? '';
    return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/library';
  }

  protected backLinkLabel(): string {
    return this.navigationHistory.backLabel(this.backLink() === '/library' ? 'Back to Library' : 'Back');
  }

  // Swiped down on the playing video: back to where the page came from, the
  // video carrying on in the miniplayer (the player hands it over).
  protected leaveToMiniplayer(): void {
    if (!this.navigationHistory.back()) {
      void this.router.navigateByUrl(this.backLink());
    }
  }

  protected goBack(event: MouseEvent): void {
    event.preventDefault();
    if (this.navigationHistory.back()) {
      return;
    }
    void this.router.navigateByUrl(this.backLink());
  }


  // Inline player hand-off details (the miniplayer's "Details" returns here).
  protected playerDetails(scene: LibrarySceneDetail): PlayerDetails {
    return libraryScenePlayerDetails(scene);
  }

  protected playNextUp(): void {
    const next = this.upNext()[0];
    if (next) {
      void this.router.navigate([...next.commands], { queryParams: { autoplay: '1' } });
    }
  }

  // "Mark as unwatched": clears the watch history in Stash.
  protected markUnwatched(stashSceneId: string): void {
    if (this.markingUnwatched()) {
      return;
    }
    this.markingUnwatched.set(true);
    this.watchProgress.markUnwatched([stashSceneId]).subscribe({
      next: () => {
        this.markingUnwatched.set(false);
        this.notifications.success('Marked as unwatched');
      },
      error: () => {
        this.markingUnwatched.set(false);
        this.notifications.error("Couldn't mark as unwatched. Please try again.");
      },
    });
  }

  protected openSeriesDialog(): void {
    this.seriesDialogOpen.set(true);
  }

  protected closeSeriesDialog(): void {
    this.seriesDialogOpen.set(false);
  }

  protected onSeriesChanged(memberships: SceneSeriesMembership[]): void {
    this.series.set(memberships);
    this.loadSeriesUpNext(memberships);
  }

  protected displayedDescription(description: string): string {
    const limit = LocalScenePageComponent.DESCRIPTION_PREVIEW_LENGTH;
    if (this.descriptionExpanded() || description.length <= limit) {
      return description;
    }

    return `${description.slice(0, limit).trimEnd()}…`;
  }

  protected hasLongDescription(description: string): boolean {
    return description.length > LocalScenePageComponent.DESCRIPTION_PREVIEW_LENGTH;
  }

  protected toggleDescription(): void {
    this.descriptionExpanded.update((value) => !value);
  }

  protected durationLabel(seconds: number | null): string | null {
    if (!seconds || seconds <= 0) {
      return null;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(Math.floor(seconds % 60)).padStart(2, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
      : `${minutes}:${rest}`;
  }

  private load(sceneId: string): void {
    this.loadSubscription?.unsubscribe();
    this.seriesSubscription?.unsubscribe();
    this.currentSceneId = sceneId;
    this.loadSeriesUpNext([]);
    this.loading.set(true);
    this.error.set(null);
    this.series.set([]);
    this.seriesDialogOpen.set(false);
    this.descriptionExpanded.set(false);

    this.loadSubscription = this.libraryService.getScene(sceneId).subscribe({
      next: (scene) => {
        this.loading.set(false);
        this.scene.set(scene);
      },
      error: () => {
        this.loading.set(false);
        this.scene.set(null);
        this.error.set('This scene is not in the local library index.');
      },
    });
    this.upNextSubscription?.unsubscribe();
    this.recommendedUpNext.set([]);
    this.upNextLoading.set(true);
    this.upNextSubscription = this.libraryService
      .getRecommended(sceneId)
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((response) => {
        this.upNextLoading.set(false);
        this.recommendedUpNext.set(response.items.map((item) => libraryUpNextItem(item)));
      });
    // Best-effort: the series row just stays hidden if Stash can't answer.
    this.seriesSubscription = this.groupsService
      .getSeriesForScene(sceneId)
      .pipe(catchError(() => of([] as SceneSeriesMembership[])))
      .subscribe((memberships) => {
        this.series.set(memberships);
        this.loadSeriesUpNext(memberships);
      });
  }

  // The rest of the (first) series this scene is in goes to the top of Up
  // next, so autoplay plays the series in order.
  private loadSeriesUpNext(memberships: SceneSeriesMembership[]): void {
    this.seriesUpNextSubscription?.unsubscribe();
    this.seriesUpNext.set([]);
    const series = memberships[0];
    const sceneId = this.currentSceneId;
    if (!series || !sceneId) {
      return;
    }

    this.seriesUpNextSubscription = this.groupsService
      .getSeriesDetail(series.id)
      .pipe(catchError(() => of(null)))
      .subscribe((detail) => this.seriesUpNext.set(detail ? seriesUpNextItems(detail, sceneId) : []));
  }
}
