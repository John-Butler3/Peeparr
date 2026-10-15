import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription, catchError, combineLatest, finalize, of } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { AcquisitionService } from '../../core/api/acquisition.service';
import { DiscoverService } from '../../core/api/discover.service';
import { integrationLabel } from '../../core/api/integrations.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import {
  SceneDetails,
  ScenePerformer,
  SceneExplorerItem,
  SceneRequestContext,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { SceneCardComponent } from '../../shared/scene-card/scene-card.component';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';
import { PlayerDetails, PlayerService } from '../../core/player/player.service';
import { WatchProgressService } from '../../core/player/watch-progress.service';
import {
  libraryUpNextItem,
  mergeUpNext,
  seriesUpNextItems,
} from '../../core/player/player-details.util';
import { LibraryService } from '../../core/api/library.service';
import { InlinePlayerComponent } from '../../shared/inline-player/inline-player.component';
import { UpNextItem, UpNextListComponent } from '../../shared/up-next-list/up-next-list.component';
import { GroupsService } from '../../core/api/groups.service';
import { SceneSeriesMembership } from '../../core/api/groups.types';
import { AddToSeriesDialogComponent } from '../../shared/add-to-series-dialog/add-to-series-dialog.component';

interface SceneLifecycleStep {
  system: string;
  title: string;
  detail: string;
  tone: 'complete' | 'active' | 'pending';
}

import { WatchDockDirective } from './watch-dock.directive';

@Component({
  selector: 'app-scene-page',
  imports: [
    WatchDockDirective,
    RouterLink,
    FormsModule,
    Message,
    ProgressSpinner,
    Select,
    ButtonDirective,
    SceneStatusBadgeComponent,
    SceneCardComponent,
    SceneRequestModalComponent,
    AddToSeriesDialogComponent,
    InlinePlayerComponent,
    UpNextListComponent,
  ],
  templateUrl: './scene-page.component.html',
  styleUrl: './scene-page.component.scss',
})
export class ScenePageComponent implements OnInit, OnDestroy {

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly discoverService = inject(DiscoverService);
  private readonly acquisitionService = inject(AcquisitionService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly sceneQuickRequestService = inject(SceneQuickRequestService);
  private readonly playerService = inject(PlayerService);
  private readonly groupsService = inject(GroupsService);
  private readonly libraryService = inject(LibraryService);
  protected readonly watchProgress = inject(WatchProgressService);
  private seriesSubscription: Subscription | null = null;
  private upNextSubscription: Subscription | null = null;
  private previousFocusedElement: HTMLElement | null = null;
  private routeSubscription: Subscription | null = null;

  @ViewChild('similarRailViewport')
  private similarRailViewport?: ElementRef<HTMLDivElement>;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly scene = signal<SceneDetails | null>(null);
  protected readonly descriptionExpanded = signal(false);
  protected readonly selectedStashCopyUrl = signal<string | null>(null);
  protected readonly markingUnwatched = signal(false);
  // Series (Stash Groups) the selected Stash copy belongs to.
  protected readonly sceneSeries = signal<SceneSeriesMembership[]>([]);
  protected readonly seriesDialogOpen = signal(false);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly favoritingStudio = signal(false);
  protected readonly performerFavoriteInFlightById = signal<Record<string, boolean>>({});
  protected readonly backLinkPath = signal('/scenes');
  protected readonly backLinkQueryParams = signal<Params>({});
  protected readonly backLinkLabel = signal('Back to Scenes');
  // YouTube watch page: Up next and autoplay.
  private readonly recommendedUpNext = signal<UpNextItem[]>([]);
  // The following parts when this scene is in a series.
  private readonly seriesUpNext = signal<UpNextItem[]>([]);
  private seriesUpNextSubscription: Subscription | null = null;
  protected readonly upNext = computed(() =>
    mergeUpNext(this.seriesUpNext(), this.recommendedUpNext()),
  );
  protected readonly upNextLoading = signal(false);
  protected readonly autoplay = signal(false);
  protected readonly similarScenes = signal<SceneExplorerItem[]>([]);
  protected readonly removingRequest = signal(false);

  ngOnInit(): void {
    this.routeSubscription = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([paramMap, queryParamMap]) => {
      const resolvedBackLink = this.parseReturnTo(queryParamMap.get('returnTo'), '/scenes');
      this.backLinkPath.set(resolvedBackLink.path);
      this.backLinkQueryParams.set(resolvedBackLink.queryParams);
      this.backLinkLabel.set(this.backLinkText(resolvedBackLink.path, 'Back to Scenes'));
      this.autoplay.set(queryParamMap.get('autoplay') === '1');

      const stashIdParam = paramMap.get('stashId')?.trim();
      if (!stashIdParam) {
        this.error.set('Scene id is missing from the route.');
        this.loading.set(false);
        return;
      }

      this.loadScene(stashIdParam);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.upNextSubscription?.unsubscribe();
    this.seriesSubscription?.unsubscribe();
    this.seriesUpNextSubscription?.unsubscribe();
  }

  protected retry(): void {
    this.loadSceneByRoute();
  }

  protected toggleDescription(): void {
    this.descriptionExpanded.update((value) => !value);
  }


  // What the miniplayer shows if playback carries on after leaving the page.
  protected playerDetails(scene: SceneDetails): PlayerDetails {
    return {
      studio: scene.studio,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate,
      performers: scene.performers.map((performer) => performer.name),
      description: scene.description,
      detailsLink: { commands: ['/scene', scene.id] },
      stashUrl: this.selectedStashViewUrl(scene),
    };
  }

  // YouTube autoplay: when the video ends, open the first Up next scene (the
  // next part when this scene is in a series) and start it.
  // Swiped down on the playing video: back to where the page came from, the
  // video carrying on in the miniplayer (the player hands it over).
  protected leaveToMiniplayer(): void {
    void this.router.navigate([this.backLinkPath()], { queryParams: this.backLinkQueryParams() });
  }

  // Tapping the docked picture goes back to the top.
  protected scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected playNextUp(): void {
    const next = this.upNext()[0];
    if (next) {
      void this.router.navigate([...next.commands], { queryParams: { autoplay: '1' } });
    }
  }

  // Once requested, the button beside the title keeps its place and shows
  // where the scene is (as on scene cards).
  protected titleStatus(scene: SceneDetails): { icon: string; label: string; tone: string } | null {
    if (this.hasStashCopy(scene)) {
      return null;
    }

    switch (scene.status.state) {
      case 'REQUESTED':
        return { icon: 'pi pi-clock', label: 'Requested', tone: 'requested' };
      case 'DOWNLOADING':
        return { icon: 'pi pi-arrow-down', label: 'Downloading', tone: 'downloading' };
      case 'IMPORT_PENDING':
        return { icon: 'pi pi-hourglass', label: 'Importing', tone: 'importing' };
      case 'FAILED':
        return { icon: 'pi pi-exclamation-triangle', label: 'Failed', tone: 'failed' };
      default:
        return null;
    }
  }

  protected hasStashCopy(scene: SceneDetails): boolean {
    return scene.stash?.exists === true && scene.stash.copies.length > 0;
  }

  /** Every copy of this scene in the library. */
  protected stashCopyIds(scene: SceneDetails): string[] {
    return scene.stash?.copies.map((copy) => copy.id) ?? [];
  }

  // "Mark as unwatched": clears the watch history in Stash.
  protected markUnwatched(stashSceneIds: readonly string[]): void {
    if (this.markingUnwatched() || stashSceneIds.length === 0) {
      return;
    }
    this.markingUnwatched.set(true);
    this.watchProgress.markUnwatched(stashSceneIds).subscribe({
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

  protected hasMultipleStashCopies(scene: SceneDetails): boolean {
    return scene.stash?.hasMultipleCopies === true;
  }

  protected hasWhisparrLink(scene: SceneDetails): boolean {
    return scene.whisparr?.exists === true && scene.whisparr.viewUrl.length > 0;
  }

  protected posterImageUrl(scene: SceneDetails): string | null {
    const portraitImages = scene.images
      .filter(
        (image): image is typeof image & { width: number; height: number } =>
          typeof image.width === 'number' &&
          typeof image.height === 'number' &&
          image.height > image.width,
      )
      .sort((a, b) => b.height / b.width - a.height / a.width);

    return portraitImages[0]?.url ?? scene.imageUrl;
  }

  protected selectedStashViewUrl(scene: SceneDetails): string | null {
    const selected = this.selectedStashCopyUrl();
    if (selected) {
      return selected;
    }

    return scene.stash?.copies[0]?.viewUrl ?? null;
  }

  protected selectedStashLabel(scene: SceneDetails): string {
    const selected = this.selectedStashViewUrl(scene);
    if (!selected) {
      return 'View in Stash';
    }

    return scene.stash?.copies.find((copy) => copy.viewUrl === selected)?.label ?? 'View in Stash';
  }

  protected onStashCopySelected(viewUrl: string | null | undefined): void {
    this.selectedStashCopyUrl.set(viewUrl ?? null);
    const scene = this.scene();
    if (scene) {
      this.loadSceneSeries(scene);
    }
  }

  protected openSeriesDialog(): void {
    this.seriesDialogOpen.set(true);
  }

  protected onSeriesDialogClosed(): void {
    this.seriesDialogOpen.set(false);
  }

  protected onSceneSeriesChanged(memberships: SceneSeriesMembership[]): void {
    this.sceneSeries.set(memberships);
    const scene = this.scene();
    this.loadSeriesUpNext(memberships, scene ? this.selectedStashCopyId(scene) : null);
  }

  protected selectedStashCopyId(scene: SceneDetails): string | null {
    const selectedViewUrl = this.selectedStashViewUrl(scene);
    if (!selectedViewUrl) {
      return null;
    }

    return scene.stash?.copies.find((copy) => copy.viewUrl === selectedViewUrl)?.id ?? null;
  }

  protected studioLogoAriaLabel(scene: SceneDetails): string {
    const studioName = scene.studio?.trim();
    if (studioName) {
      return `Open studio ${studioName}`;
    }

    return 'Open studio';
  }

  protected formattedDuration(durationSeconds: number | null): string | null {
    if (!durationSeconds || durationSeconds <= 0) {
      return null;
    }

    const minutes = Math.floor(durationSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = Math.floor(durationSeconds % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  protected hasLongDescription(description: string | null): boolean {
    if (!description) {
      return false;
    }

    return this.normalizeDescription(description).length > 360;
  }

  protected displayedDescription(description: string | null): string | null {
    if (!description) {
      return null;
    }

    const normalized = this.normalizeDescription(description);
    if (this.descriptionExpanded() || normalized.length <= 360) {
      return normalized;
    }

    return `${normalized.slice(0, 357)}...`;
  }

  protected performerInitial(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
  }

  protected formattedGender(gender: string | null): string | null {
    if (!gender || gender.trim().length === 0) {
      return null;
    }

    return gender
      .split('_')
      .map((token) => token.charAt(0) + token.slice(1).toLowerCase())
      .join(' ');
  }

  protected lifecycleSummary(scene: SceneDetails): string {
    const providerLabel = integrationLabel(scene.source);

    switch (scene.status.state) {
      case 'REQUESTED':
        return 'Requested in Whisparr and waiting for acquisition to begin.';
      case 'DOWNLOADING':
        return 'Whisparr is actively acquiring this scene.';
      case 'IMPORT_PENDING':
        return 'Whisparr has the file, but Stash has not imported it yet.';
      case 'AVAILABLE':
        return 'Imported into Stash and available in your local library.';
      case 'FAILED':
        return 'The last known acquisition attempt failed in Whisparr. Resolve or retry this download in Whisparr.';
      case 'NOT_REQUESTED':
      default:
        return `Discovered in ${providerLabel} and not yet sent into your local acquisition pipeline.`;
    }
  }

  protected lifecycleSteps(scene: SceneDetails): SceneLifecycleStep[] {
    const providerLabel = integrationLabel(scene.source);

    return [
      {
        system: providerLabel,
        title: 'Discovered',
        detail: `Metadata, credits, and source links on this page come from ${providerLabel}.`,
        tone: 'complete',
      },
      this.whisparrLifecycleStep(scene),
      this.stashLifecycleStep(scene),
    ];
  }

  protected canRequestScene(scene: SceneDetails): boolean {
    return isSceneStatusRequestable(scene.status);
  }

  // Covers the gap between "not requested yet" and "already in Stash":
  // Whisparr has a request tracked (or it failed) but there's no local
  // copy to play yet, so the only useful action is backing the request
  // out again.
  protected canRemoveRequest(scene: SceneDetails): boolean {
    return (
      !this.hasStashCopy(scene) &&
      (scene.status.state === 'REQUESTED' ||
        scene.status.state === 'DOWNLOADING' ||
        scene.status.state === 'IMPORT_PENDING' ||
        scene.status.state === 'FAILED')
    );
  }

  protected removeSceneRequestFromHero(scene: SceneDetails): void {
    if (this.removingRequest()) {
      return;
    }

    const confirmed = window.confirm(
      `Remove "${scene.title}" from your requests and delete it from Whisparr?`,
    );
    if (!confirmed) {
      return;
    }

    this.removingRequest.set(true);
    this.acquisitionService
      .removeSceneRequest(scene.id)
      .pipe(finalize(() => this.removingRequest.set(false)))
      .subscribe({
        next: () => {
          this.notifications.success('Removed from requests');
          this.loadScene(scene.id);
        },
        error: () => {
          this.notifications.error(`Failed to remove "${scene.title}". Please try again.`);
        },
      });
  }

  protected isSimilarSceneRequestable(item: SceneExplorerItem): boolean {
    return item.requestable && isSceneStatusRequestable(item.status);
  }

  protected openSimilarSceneRequestModal(item: SceneRequestContext): void {
    this.sceneQuickRequestService.tryQuickRequest(item.id).subscribe(({ submitted }) => {
      if (submitted) {
        this.similarScenes.update((current) =>
          current.map((scene) =>
            scene.id === item.id
              ? { ...scene, requestable: false, status: { state: 'REQUESTED' } }
              : scene,
          ),
        );
        return;
      }

      this.previousFocusedElement = document.activeElement as HTMLElement | null;
      this.requestContext.set(item);
      this.requestModalOpen.set(true);
    });
  }

  protected scrollSimilarRail(direction: 'prev' | 'next'): void {
    const viewport = this.similarRailViewport?.nativeElement;
    if (!viewport) {
      return;
    }

    const delta = Math.max(viewport.clientWidth * 0.82, 320);
    viewport.scrollBy({ left: direction === 'next' ? delta : -delta, behavior: 'smooth' });
  }

  protected failedRemediationVisible(scene: SceneDetails): boolean {
    return scene.status.state === 'FAILED';
  }

  protected canToggleFavoriteStudio(scene: SceneDetails): boolean {
    if (!scene.studioId) {
      return false;
    }

    return !this.favoritingStudio();
  }

  protected studioFavoriteAriaLabel(scene: SceneDetails): string {
    const studioName = scene.studio?.trim();
    if (studioName) {
      return scene.studioIsFavorite
        ? `Unfavorite studio ${studioName}`
        : `Favorite studio ${studioName}`;
    }

    return scene.studioIsFavorite ? 'Unfavorite studio' : 'Favorite studio';
  }

  protected studioFavoriteTitle(scene: SceneDetails): string {
    return this.studioFavoriteAriaLabel(scene);
  }

  protected toggleFavoriteStudio(scene: SceneDetails): void {
    if (!scene.studioId) {
      this.notifications.info('Studio information is unavailable');
      return;
    }

    if (this.favoritingStudio()) {
      return;
    }

    const nextFavorite = !scene.studioIsFavorite;

    this.favoritingStudio.set(true);
    this.discoverService
      .favoriteStudio(scene.studioId, nextFavorite)
      .pipe(
        finalize(() => {
          this.favoritingStudio.set(false);
        }),
      )
      .subscribe({
        next: (result) => {
          this.scene.update((current) =>
            current ? { ...current, studioIsFavorite: nextFavorite } : current,
          );

          if (nextFavorite && result.alreadyFavorited) {
            this.notifications.info('Studio already favorited');
            return;
          }

          this.notifications.success(nextFavorite ? 'Studio favorited' : 'Studio unfavorited');
        },
        error: () => {
          this.notifications.error(
            nextFavorite ? 'Failed to favorite studio' : 'Failed to unfavorite studio',
          );
        },
      });
  }

  protected performerFavoriteToggleBusy(performerId: string): boolean {
    return this.performerFavoriteInFlightById()[performerId] === true;
  }

  protected performerFavoriteToggleLabel(isFavorite: boolean): string {
    return isFavorite ? 'Unfavorite performer' : 'Favorite performer';
  }

  protected toggleScenePerformerFavorite(event: Event, performer: ScenePerformer): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.performerFavoriteToggleBusy(performer.id)) {
      return;
    }

    const nextFavorite = !performer.isFavorite;
    this.setPerformerFavoriteBusy(performer.id, true);
    this.discoverService
      .favoritePerformer(performer.id, nextFavorite)
      .pipe(
        finalize(() => {
          this.setPerformerFavoriteBusy(performer.id, false);
        }),
      )
      .subscribe({
        next: (result) => {
          this.scene.update((current) =>
            current
              ? {
                  ...current,
                  performers: current.performers.map((currentPerformer) =>
                    currentPerformer.id === performer.id
                      ? { ...currentPerformer, isFavorite: nextFavorite }
                      : currentPerformer,
                  ),
                }
              : current,
          );

          if (nextFavorite && result.alreadyFavorited) {
            this.notifications.info('Performer already favorited');
            return;
          }

          this.notifications.success(
            nextFavorite ? 'Performer favorited' : 'Performer unfavorited',
          );
        },
        error: () => {
          this.notifications.error(
            nextFavorite ? 'Failed to favorite performer' : 'Failed to unfavorite performer',
          );
        },
      });
  }

  protected openRequestPanel(scene: SceneDetails): void {
    if (!this.canRequestScene(scene)) {
      return;
    }

    this.sceneQuickRequestService.tryQuickRequest(scene.id).subscribe(({ submitted }) => {
      if (submitted) {
        this.onRequestSubmitted(scene.id);
        return;
      }

      this.previousFocusedElement = document.activeElement as HTMLElement | null;
      this.requestContext.set({
        id: scene.id,
        title: scene.title,
        imageUrl: scene.imageUrl,
      });
      this.requestModalOpen.set(true);
    });
  }

  protected onRequestModalClosed(): void {
    this.requestModalOpen.set(false);

    setTimeout(() => {
      this.previousFocusedElement?.focus();
      this.previousFocusedElement = null;
    }, 0);
  }

  // The request modal is shared between the page's own scene and the
  // Similar rail below -- a submission for the current scene reloads the
  // whole page's state (status badge, actions, etc. all depend on it), but
  // a submission for a similar-rail item must only patch that one card in
  // place, or it would blow away the current scene and load the rail
  // item's details into the hero instead.
  protected onRequestSubmitted(stashId: string): void {
    if (stashId === this.scene()?.id) {
      this.loadScene(stashId);
      return;
    }

    this.similarScenes.update((current) =>
      current.map((scene) =>
        scene.id === stashId
          ? { ...scene, requestable: false, status: { state: 'REQUESTED' } }
          : scene,
      ),
    );
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  private loadSceneByRoute(): void {
    const stashIdParam = this.route.snapshot.paramMap.get('stashId')?.trim();
    if (!stashIdParam) {
      this.error.set('Scene id is missing from the route.');
      this.loading.set(false);
      return;
    }

    this.loadScene(stashIdParam);
  }

  private loadScene(stashIdParam: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.descriptionExpanded.set(false);
    this.selectedStashCopyUrl.set(null);
    this.requestModalOpen.set(false);
    this.performerFavoriteInFlightById.set({});
    this.similarScenes.set([]);
    this.sceneSeries.set([]);
    this.seriesDialogOpen.set(false);

    this.discoverService
      .getSceneDetails(stashIdParam)
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe({
        next: (scene) => {
          this.scene.set(scene);
          this.selectedStashCopyUrl.set(scene.stash?.copies[0]?.viewUrl ?? null);
          this.loadSceneSeries(scene);
          this.loadUpNext(scene);
          this.requestContext.set({
            id: scene.id,
            title: scene.title,
            imageUrl: scene.imageUrl,
          });
          this.loadSimilarScenes(scene.id);
        },
        error: () => {
          this.error.set('Failed to load scene details from the API.');
        },
      });
  }

  private loadSceneSeries(scene: SceneDetails): void {
    this.seriesSubscription?.unsubscribe();
    this.sceneSeries.set([]);
    this.loadSeriesUpNext([], null);
    const copyId = this.selectedStashCopyId(scene);
    if (!copyId) {
      return;
    }

    // Best-effort: the series row just stays hidden if Stash can't answer.
    this.seriesSubscription = this.groupsService
      .getSeriesForScene(copyId)
      .pipe(catchError(() => of([] as SceneSeriesMembership[])))
      .subscribe((memberships) => {
        this.sceneSeries.set(memberships);
        this.loadSeriesUpNext(memberships, copyId);
      });
  }

  // The rest of the (first) series this scene is in goes to the top of Up
  // next, so autoplay plays the series in order.
  private loadSeriesUpNext(memberships: SceneSeriesMembership[], copyId: string | null): void {
    this.seriesUpNextSubscription?.unsubscribe();
    this.seriesUpNext.set([]);
    const series = memberships[0];
    if (!series || !copyId) {
      return;
    }

    this.seriesUpNextSubscription = this.groupsService
      .getSeriesDetail(series.id)
      .pipe(catchError(() => of(null)))
      .subscribe((detail) => this.seriesUpNext.set(detail ? seriesUpNextItems(detail, copyId) : []));
  }

  // Up next: library scenes with all-female performers. In the library, from
  // this scene's own performers; otherwise from its female performers (by
  // catalog id), ahead of the catalog's similar scenes.
  private loadUpNext(scene: SceneDetails): void {
    this.upNextSubscription?.unsubscribe();
    this.recommendedUpNext.set([]);
    const copyId = this.selectedStashCopyId(scene);
    const femalePerformerIds = scene.performers
      .filter((performer) => performer.gender === 'FEMALE')
      .map((performer) => performer.id);
    const request = copyId
      ? this.libraryService.getRecommended(copyId)
      : femalePerformerIds.length > 0
        ? this.libraryService.getRecommendedForPerformers(femalePerformerIds)
        : null;
    if (!request) {
      this.upNextLoading.set(false);
      return;
    }

    this.upNextLoading.set(true);
    this.upNextSubscription = request
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((response) => {
        this.upNextLoading.set(false);
        this.recommendedUpNext.set(response.items.map((item) => libraryUpNextItem(item)));
      });
  }

  // Not in the library: its performers' library scenes, then similar ones.
  protected catalogUpNext(): UpNextItem[] {
    return mergeUpNext(this.recommendedUpNext(), this.similarUpNext());
  }

  protected similarUpNext(): UpNextItem[] {
    return this.similarScenes().map((item) => ({
      id: item.id,
      title: item.title,
      imageUrl: item.cardImageUrl ?? item.imageUrl,
      studio: item.studio,
      studioImageUrl: item.studioImageUrl,
      // Previewable only when the similar scene is in the library.
      previewKind: item.status?.state === 'AVAILABLE' ? 'catalog' : null,
      releaseDate: item.releaseDate,
      duration: item.duration,
      commands: ['/scene', item.id],
    }));
  }

  private loadSimilarScenes(stashId: string): void {
    this.discoverService
      .getSimilarScenes(stashId)
      .pipe(catchError(() => of({ items: [] as SceneExplorerItem[] })))
      .subscribe((response) => {
        this.similarScenes.set(response.items);
      });
  }

  private normalizeDescription(description: string): string {
    return description.replaceAll(/\s+/g, ' ').trim();
  }

  private whisparrLifecycleStep(scene: SceneDetails): SceneLifecycleStep {
    switch (scene.status.state) {
      case 'REQUESTED':
        return {
          system: 'Whisparr',
          title: 'Requested',
          detail: 'Whisparr knows about this scene, but acquisition has not started.',
          tone: 'active',
        };
      case 'DOWNLOADING':
        return {
          system: 'Whisparr',
          title: 'Downloading',
          detail: 'Whisparr is actively pulling the asset into your pipeline.',
          tone: 'active',
        };
      case 'IMPORT_PENDING':
        return {
          system: 'Whisparr',
          title: 'Ready for import',
          detail: 'Whisparr has finished acquisition and is waiting for Stash to pick it up.',
          tone: 'complete',
        };
      case 'AVAILABLE':
        return {
          system: 'Whisparr',
          title: 'Handled',
          detail: scene.whisparr?.exists
            ? 'Whisparr has a linked record for this scene.'
            : 'The request pipeline has already handed this scene off to your library.',
          tone: 'complete',
        };
      case 'FAILED':
        return {
          system: 'Whisparr',
          title: 'Failed',
          detail:
            'The last known acquisition attempt failed. Resolve or retry this download in Whisparr because Peeparr does not remediate failed Whisparr jobs.',
          tone: 'active',
        };
      case 'NOT_REQUESTED':
      default:
        return {
          system: 'Whisparr',
          title: 'Not requested',
          detail: 'No Whisparr request or tracked acquisition is linked yet.',
          tone: 'pending',
        };
    }
  }

  private stashLifecycleStep(scene: SceneDetails): SceneLifecycleStep {
    if (scene.status.state === 'AVAILABLE') {
      return {
        system: 'Stash',
        title: 'In library',
        detail: 'A linked local scene is available in Stash.',
        tone: 'complete',
      };
    }

    if (scene.status.state === 'IMPORT_PENDING') {
      return {
        system: 'Stash',
        title: 'Awaiting import',
        detail: 'Stash has not linked a local copy yet.',
        tone: 'active',
      };
    }

    return {
      system: 'Stash',
      title: 'Not in library',
      detail: 'No linked Stash scene is available yet.',
      tone: 'pending',
    };
  }

  private parseReturnTo(
    rawReturnTo: string | null,
    fallback: string,
  ): { path: string; queryParams: Params } {
    const trimmed = rawReturnTo?.trim();
    if (!trimmed) {
      return { path: fallback, queryParams: {} };
    }

    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return { path: fallback, queryParams: {} };
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
      return { path: fallback, queryParams: {} };
    }

    try {
      const parsed = this.router.parseUrl(trimmed);
      const primarySegments = parsed.root.children['primary']?.segments ?? [];
      const path = `/${primarySegments.map((segment) => segment.path).join('/')}`;
      const canonicalPath = path === '/discover' ? '/scenes' : path;
      return {
        path: canonicalPath === '/' ? fallback : canonicalPath,
        queryParams: parsed.queryParams,
      };
    } catch {
      return { path: fallback, queryParams: {} };
    }
  }

  private backLinkText(returnTo: string, fallbackLabel: string): string {
    if (returnTo.startsWith('/home')) {
      return 'Back to Home';
    }
    if (returnTo.startsWith('/scenes')) {
      return 'Back to Scenes';
    }
    if (returnTo.startsWith('/acquisition')) {
      return 'Back to Acquisition';
    }
    if (returnTo.startsWith('/library')) {
      return 'Back to Library';
    }
    if (returnTo.startsWith('/performers')) {
      return 'Back to Performers';
    }
    if (returnTo.startsWith('/performer/')) {
      return 'Back to Performer';
    }
    if (returnTo.startsWith('/studios')) {
      return 'Back to Studios';
    }
    if (returnTo.startsWith('/studio/')) {
      return 'Back to Studio';
    }
    if (returnTo.startsWith('/scene/')) {
      return 'Back to Scene';
    }

    return fallbackLabel;
  }

  private setPerformerFavoriteBusy(performerId: string, busy: boolean): void {
    this.performerFavoriteInFlightById.update((current) => {
      if (busy) {
        return {
          ...current,
          [performerId]: true,
        };
      }

      const next = { ...current };
      delete next[performerId];
      return next;
    });
  }
}
