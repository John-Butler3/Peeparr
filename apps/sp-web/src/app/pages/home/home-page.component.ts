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
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Subscription, catchError, debounceTime, filter, finalize, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SearchSuggestComponent } from '../../shared/search-suggest/search-suggest.component';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import {
  SceneExplorerItem,
  SceneRequestContext,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { HomeService } from '../../core/api/home.service';
import {
  HomeHeroItem,
  HomeHeroResponse,
  HomeRailContentResponse,
  HomeRailItem,
} from '../../core/api/home.types';
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

import { onShowingPage } from '../../core/navigation/page-fade.service';
@Component({
  selector: 'app-home-page',
  imports: [
    SearchSuggestComponent,
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
  private heroSubscription: Subscription | null = null;
  private favoriteReleasesSubscription: Subscription | null = null;

  @ViewChildren('railViewport')
  private railViewports?: QueryList<ElementRef<HTMLDivElement>>;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly continueWatchingItems = signal<HomeRailItem[]>([]);
  protected readonly recentlyAddedItems = signal<HomeRailItem[]>([]);
  /** The banner: newest scenes mixed with random unwatched ones. */
  protected readonly heroItems = signal<HomeHeroItem[]>([]);
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

  // The phone's search box; live results drop down under it (SearchSuggest).
  protected readonly searchTerm = signal('');

  /** While Home is open, it re-checks your library this often. */
  static readonly REFRESH_MS = 60_000;
  /** Coming back to the app re-checks too, if it's been at least this long. */
  static readonly RESUME_REFRESH_AFTER_MS = 15_000;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastRefreshAt = 0;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** On screen: not asleep (left, kept alive) and the app not in the background. */
  private awake(): boolean {
    return document.visibilityState === 'visible' && onShowingPage(this.host);
  }
  /** A place was saved while Home was away: Continue Watching is out of date. */
  private continueWatchingStale = false;
  private readonly onVisibilityChange = (): void => {
    if (!this.awake()) {
      return;
    }
    if (Date.now() - this.lastRefreshAt > HomePageComponent.RESUME_REFRESH_AFTER_MS) {
      this.refreshLibraryRows();
    } else if (this.continueWatchingStale) {
      this.loadContinueWatching();
    }
    this.continueWatchingStale = false;
  };
  // A scene's place saved (watching it, leaving it, closing the miniplayer):
  // Continue Watching follows straight away, or as soon as Home is back.
  private readonly progressWatch = inject(PlayerService)
    .progressSaved.pipe(debounceTime(300))
    .subscribe(() => {
      if (this.awake()) {
        this.loadContinueWatching();
      } else {
        this.continueWatchingStale = true;
      }
    });
  // Back on Home after a while away (the page was kept, asleep): catch up.
  private readonly navigationWatch = inject(Router)
    .events.pipe(filter((event) => event instanceof NavigationEnd))
    .subscribe(() => this.onVisibilityChange());

  ngOnInit(): void {
    this.runtimeHealthService.ensureStarted();
    this.refreshLibraryRows();
    this.loadPopular();
    // New scenes in Stash show up without reloading the page.
    this.refreshTimer = setInterval(() => {
      if (this.awake()) {
        this.refreshLibraryRows();
      }
    }, HomePageComponent.REFRESH_MS);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private refreshLibraryRows(): void {
    this.lastRefreshAt = Date.now();
    this.loadContinueWatching();
    this.loadRecentlyAdded();
    this.loadHero();
  }

  // Only replaces a row when it changed, so the banner's preview isn't
  // restarted by a refresh that found nothing new.
  private setIfChanged<T extends HomeRailItem>(
    target: { (): T[]; set(items: T[]): void },
    items: T[],
  ): void {
    const key = (list: T[]) =>
      list.map((item) => `${item.id}|${item.cardImageUrl}|${item.progressPercent ?? ''}`).join(',');
    if (key(target()) !== key(items)) {
      target.set(items);
    }
  }

  private loadPopular(): void {
    this.discoverService
      .getPopularScenes()
      .pipe(catchError(() => of({ items: [] as SceneExplorerItem[] })))
      .subscribe((response) => this.popularItems.set(response.items));
  }

  ngOnDestroy(): void {
    this.navigationWatch.unsubscribe();
    this.progressWatch.unsubscribe();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.continueWatchingSubscription?.unsubscribe();
    this.recentlyAddedSubscription?.unsubscribe();
    this.heroSubscription?.unsubscribe();
    this.favoriteReleasesSubscription?.unsubscribe();
  }

  protected onSearchInput(value: string): void {
    this.searchTerm.set(value);
  }

  protected submitSearch(): void {
    const query = this.searchTerm().trim();
    if (!query) {
      return;
    }

    void this.router.navigate(['/search'], { queryParams: { q: query } });
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
  }

  protected loadContinueWatching(): void {
    this.continueWatchingSubscription?.unsubscribe();
    this.continueWatchingSubscription = this.homeService
      .getContinueWatching()
      .pipe(catchError(() => of<HomeRailContentResponse>({ items: [], message: null })))
      .subscribe((response) => this.setIfChanged(this.continueWatchingItems, response.items));
  }

  protected loadRecentlyAdded(): void {
    this.recentlyAddedSubscription?.unsubscribe();
    this.recentlyAddedSubscription = this.homeService
      .getRecentlyAdded()
      .pipe(catchError(() => of<HomeRailContentResponse>({ items: [], message: null })))
      .subscribe((response) => this.setIfChanged(this.recentlyAddedItems, response.items));
  }

  protected loadHero(): void {
    this.heroSubscription?.unsubscribe();
    this.heroSubscription = this.homeService
      .getHero()
      .pipe(catchError(() => of<HomeHeroResponse>({ items: [] })))
      .subscribe((response) => this.setIfChanged(this.heroItems, response.items));
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
      this.recentlyAddedItems().find((item) => item.id === localSceneId) ??
      this.heroItems().find((item) => item.id === localSceneId);
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
