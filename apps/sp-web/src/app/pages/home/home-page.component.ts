import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  of,
  switchMap,
} from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import {
  PerformerFeedItem,
  SceneExplorerItem,
  SceneRequestContext,
  StudioFeedItem,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { HomeService } from '../../core/api/home.service';
import { HomeRailContentResponse, HomeRailItem } from '../../core/api/home.types';
import { PlayerService } from '../../core/player/player.service';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SceneCardComponent } from '../../shared/scene-card/scene-card.component';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import {
  buildReadinessPageAlert,
  firstUseEmptyStateCopy,
  initialIndexingGuidance,
} from '../../shared/readiness/first-run-readiness.utils';

import { HomeHeroComponent } from './home-hero/home-hero.component';
import { Reveal } from '../../shared/show-more/reveal';

@Component({
  selector: 'app-home-page',
  imports: [
    RouterLink,
    FormsModule,
    ProgressSpinner,
    SceneCardComponent,
    SceneRequestModalComponent,
    HomeHeroComponent,
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent implements OnInit, OnDestroy {
  private readonly discoverService = inject(DiscoverService);
  private readonly sceneQuickRequestService = inject(SceneQuickRequestService);
  private readonly homeService = inject(HomeService);
  private readonly playerService = inject(PlayerService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly router = inject(Router);

  private continueWatchingSubscription: Subscription | null = null;
  private recentlyAddedSubscription: Subscription | null = null;
  private favoriteReleasesSubscription: Subscription | null = null;
  private searchSubscription: Subscription | null = null;
  private readonly searchTerms = new Subject<string>();

  @ViewChildren('railViewport')
  private railViewports?: QueryList<ElementRef<HTMLDivElement>>;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly continueWatchingItems = signal<HomeRailItem[]>([]);
  protected readonly recentlyAddedItems = signal<HomeRailItem[]>([]);
  protected readonly favoriteReleaseItems = signal<SceneExplorerItem[]>([]);
  // ThePornDB website's popular scenes (top of Home); empty when unavailable.
  protected readonly popularItems = signal<SceneExplorerItem[]>([]);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly pageAlert = computed(() =>
    buildReadinessPageAlert(
      'home',
      this.setupStatusStore.status(),
      this.runtimeHealthService.status(),
    ),
  );
  protected readonly favoritingSupported = computed(
    () => this.setupStatusStore.status()?.catalogProvider !== 'TPDB',
  );
  protected readonly favoriteReleasesKicker = computed(() =>
    this.favoritingSupported() ? 'Favorites' : 'Recently added',
  );
  protected readonly favoriteReleasesTitle = computed(() =>
    this.favoritingSupported()
      ? 'Recently released from your favorites'
      : 'Recently released scenes',
  );

  protected readonly searchTerm = signal('');
  protected readonly searchOpen = signal(false);
  protected readonly searchLoading = signal(false);
  protected readonly searchSceneResults = signal<SceneExplorerItem[]>([]);
  protected readonly searchPerformerResults = signal<PerformerFeedItem[]>([]);
  protected readonly searchStudioResults = signal<StudioFeedItem[]>([]);
  // 4 performers, 4 sites and 5 scenes at first, then more on request.
  protected readonly searchPerformersShown = new Reveal(4, 8);
  protected readonly searchStudiosShown = new Reveal(4, 8);
  protected readonly searchScenesShown = new Reveal(5, 10);

  ngOnInit(): void {
    this.runtimeHealthService.ensureStarted();
    this.setupSearch();
    this.loadContinueWatching();
    this.loadRecentlyAdded();
    this.loadPopular();
  }

  private loadPopular(): void {
    this.discoverService
      .getPopularScenes()
      .pipe(catchError(() => of({ items: [] as SceneExplorerItem[] })))
      .subscribe((response) => this.popularItems.set(response.items));
  }

  ngOnDestroy(): void {
    this.continueWatchingSubscription?.unsubscribe();
    this.recentlyAddedSubscription?.unsubscribe();
    this.favoriteReleasesSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
  }

  protected onSearchInput(value: string): void {
    const nextValue = value;
    this.searchTerm.set(nextValue);
    this.searchOpen.set(nextValue.trim().length > 0);
    this.searchTerms.next(nextValue);
  }

  protected closeSearch(): void {
    this.searchOpen.set(false);
  }

  protected submitSearch(): void {
    const query = this.searchTerm().trim();
    if (!query) {
      return;
    }

    this.closeSearch();
    void this.router.navigate(['/search'], { queryParams: { q: query } });
  }

  protected onSearchFocus(): void {
    if (this.searchTerm().trim().length > 0) {
      this.searchOpen.set(true);
    }
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
    this.searchOpen.set(false);
    this.searchSceneResults.set([]);
    this.searchPerformerResults.set([]);
    this.searchStudioResults.set([]);
    this.searchTerms.next('');
  }

  protected hasSearchResults(): boolean {
    return (
      this.searchSceneResults().length > 0 ||
      this.searchPerformerResults().length > 0 ||
      this.searchStudioResults().length > 0
    );
  }

  private setupSearch(): void {
    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          const query = term.trim();
          if (!query) {
            this.searchLoading.set(false);
            return of(null);
          }

          this.searchLoading.set(true);
          return forkJoin({
            scenes: this.discoverService
              .getScenesFeed(1, 24, 'TITLE', 'ASC', [], undefined, undefined, [], query)
              .pipe(catchError(() => of({ items: [] as SceneExplorerItem[] }))),
            performers: this.discoverService
              .getPerformersFeed(1, 24, { name: query })
              .pipe(catchError(() => of({ items: [] as PerformerFeedItem[] }))),
            studios: this.discoverService
              .getStudiosFeed(1, 24, { name: query })
              .pipe(catchError(() => of({ items: [] as StudioFeedItem[] }))),
          }).pipe(finalize(() => this.searchLoading.set(false)));
        }),
      )
      .subscribe((result) => {
        this.searchPerformersShown.reset();
        this.searchStudiosShown.reset();
        this.searchScenesShown.reset();
        if (!result) {
          this.searchSceneResults.set([]);
          this.searchPerformerResults.set([]);
          this.searchStudioResults.set([]);
          return;
        }

        this.searchSceneResults.set(result.scenes.items);
        this.searchPerformerResults.set(result.performers.items);
        this.searchStudioResults.set(result.studios.items);
      });
  }

  protected loadContinueWatching(): void {
    this.continueWatchingSubscription?.unsubscribe();
    this.continueWatchingSubscription = this.homeService
      .getContinueWatching()
      .pipe(catchError(() => of<HomeRailContentResponse>({ items: [], message: null })))
      .subscribe((response) => {
        this.continueWatchingItems.set(response.items);
      });
  }

  protected loadRecentlyAdded(): void {
    this.recentlyAddedSubscription?.unsubscribe();
    this.recentlyAddedSubscription = this.homeService
      .getRecentlyAdded()
      .pipe(catchError(() => of<HomeRailContentResponse>({ items: [], message: null })))
      .subscribe((response) => {
        this.recentlyAddedItems.set(response.items);
      });
  }

  protected loadFavoriteReleases(): void {
    this.favoriteReleasesSubscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    this.favoriteReleasesSubscription = this.discoverService
      .getScenesFeed(
        1,
        16,
        'DATE',
        'DESC',
        [],
        undefined,
        this.favoritingSupported() ? 'ALL' : undefined,
        [],
      )
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => {
          this.favoriteReleaseItems.set(response.items);
        },
        error: () => {
          this.error.set('Unable to load recently released favorites right now.');
        },
      });
  }

  protected retryFavoriteReleases(): void {
    this.loadFavoriteReleases();
  }

  protected isPageEmptyState(): boolean {
    if (this.loading() || this.error()) {
      return false;
    }

    return (
      this.continueWatchingItems().length === 0 &&
      this.recentlyAddedItems().length === 0 &&
      this.favoriteReleaseItems().length === 0
    );
  }

  protected emptyStateTitle(): string {
    return firstUseEmptyStateCopy('home').title;
  }

  protected emptyStateMessage(): string {
    if (this.pageAlert()) {
      return 'Home may be empty because required integrations are degraded. Repair integrations, then refresh Home to reload.';
    }

    return firstUseEmptyStateCopy('home').message;
  }

  protected indexingGuidance(): string {
    return initialIndexingGuidance();
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected isRequestable(item: SceneExplorerItem): boolean {
    return item.requestable && isSceneStatusRequestable(item.status);
  }

  protected playPopularScene(catalogSceneId: string): void {
    const item = this.popularItems().find((item) => item.id === catalogSceneId);
    this.playerService.openByCatalogSceneId({
      title: item?.title ?? 'Scene',
      catalogStashId: catalogSceneId,
      imageUrl: item?.cardImageUrl ?? item?.imageUrl,
      details: {
        studio: item?.studio ?? null,
        studioImageUrl: item?.studioImageUrl ?? null,
        releaseDate: item?.releaseDate ?? null,
        description: item?.description ?? null,
        detailsLink: { commands: ['/scene', catalogSceneId] },
      },
    });
  }

  protected playScene(localSceneId: string): void {
    const item =
      this.continueWatchingItems().find((item) => item.id === localSceneId) ??
      this.recentlyAddedItems().find((item) => item.id === localSceneId);
    this.playerService.openByLocalSceneId({
      title: item?.title ?? 'Scene',
      localSceneId,
      imageUrl: item?.cardImageUrl ?? item?.imageUrl,
      details: item
        ? {
            studio: item.studio,
            studioImageUrl: item.studioImageUrl,
            releaseDate: item.releaseDate,
            description: item.description,
            detailsLink: item.activeCatalogSceneId
              ? { commands: ['/scene', item.activeCatalogSceneId] }
              : { commands: ['/library/scene', item.id] },
            stashUrl: item.viewUrl,
          }
        : null,
    });
  }

  protected markWatched(localSceneId: string): void {
    this.homeService.resetContinueWatchingProgress(localSceneId).subscribe({
      next: () => {
        this.continueWatchingItems.update((items) =>
          items.filter((item) => item.id !== localSceneId),
        );
      },
    });
  }

  protected openRequestModal(item: SceneRequestContext): void {
    this.sceneQuickRequestService.tryQuickRequest(item.id).subscribe(({ submitted }) => {
      if (submitted) {
        this.onRequestSubmitted(item.id);
        return;
      }

      this.requestContext.set(item);
      this.requestModalOpen.set(true);
    });
  }

  protected onRequestModalClosed(): void {
    this.requestModalOpen.set(false);
  }

  protected onRequestSubmitted(stashId: string): void {
    const markRequested = (items: SceneExplorerItem[]) =>
      items.map((item) =>
        item.id === stashId
          ? { ...item, requestable: false, status: { state: 'REQUESTED' as const } }
          : item,
      );
    this.favoriteReleaseItems.update(markRequested);
    this.popularItems.update(markRequested);
  }

  protected scrollRail(railId: string, direction: 'prev' | 'next'): void {
    const viewport = this.findRailViewport(railId);
    if (!viewport) {
      return;
    }

    const delta = Math.max(viewport.clientWidth * 0.82, 320);
    viewport.scrollBy({
      left: direction === 'next' ? delta : -delta,
      behavior: 'smooth',
    });
  }

  private findRailViewport(railId: string): HTMLDivElement | null {
    return (
      this.railViewports?.find(
        (elementRef) => elementRef.nativeElement.dataset['railId'] === railId,
      )?.nativeElement ?? null
    );
  }
}
