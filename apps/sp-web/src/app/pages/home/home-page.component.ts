import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, NavigationStart, Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { EMPTY, Subscription, catchError, filter, finalize, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { LibraryService } from '../../core/api/library.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SearchSuggestComponent } from '../../shared/search-suggest/search-suggest.component';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import {
  PerformerFeedItem,
  SceneExplorerItem,
  SceneRequestContext,
  StudioFeedItem,
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

import { PageFadeService, onShowingPage } from '../../core/navigation/page-fade.service';
import { LogoContrastDirective } from '../../shared/logo-contrast/logo-contrast.directive';
import { WatchProgressService } from '../../core/player/watch-progress.service';
@Component({
  selector: 'app-home-page',
  imports: [
    LogoContrastDirective,
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
  private readonly libraryService = inject(LibraryService);
  protected readonly watchProgress = inject(WatchProgressService);
  private readonly notifications = inject(AppNotificationsService);
  // The last scene shuffled to (not picked again straight away).
  private lastRandomSceneId: string | undefined;

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
  protected readonly popularPerformers = signal<PerformerFeedItem[]>([]);
  protected readonly popularSites = signal<StudioFeedItem[]>([]);
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
  protected readonly shuffling = signal(false);
  /** Continue Watching's arrival playing: the whole section, or a card at the front. */
  protected readonly continueWatchingArriving = signal<'section' | 'card' | null>(null);
  protected readonly continueWatchingFront = signal<string | null>(null);
  /** A scene watched to the end while it's listed is gone at once. */
  protected readonly visibleContinueWatching = computed(() =>
    this.continueWatchingItems().filter((item) => this.watchProgress.percentFor(item.id) !== 100),
  );
  private continueWatchingLoaded = false;
  /** The latest reload (one that's still getting ready gives way to it). */
  private continueWatchingRun = 0;
  // Its height, for the rows below to slide by: taken as soon as it changes,
  // before anything's drawn. (Going, it's still there, on its way out.)
  private readonly continueWatchingHeight = effect(() => {
    this.visibleContinueWatching();
    afterNextRender(
      () => {
        const section = this.continueWatchingSection();
        if (section) {
          const margin = parseFloat(getComputedStyle(section).marginTop) || 0;
          this.host.style.setProperty('--cw-h', `${section.offsetHeight + margin}px`);
        }
      },
      { injector: this.injector },
    );
  });
  /** Scenes whose place was saved in this visit, latest first. */
  private savedLately: string[] = [];
  private arrivalTimer: ReturnType<typeof setTimeout> | null = null;
  /** A little longer than the animations. */
  private static readonly ARRIVAL_MS = 1200;
  /** Longest to wait for its pictures, before showing it anyway. */
  private static readonly PRELOAD_MAX_MS = 800;
  private static readonly SETTLE_MAX_MS = 500;
  /** Longest Home's return is held for an up-to-date Continue Watching. */
  private static readonly RETURN_HOLD_MAX_MS = 400;

  /** While Home is open, it re-checks your library this often. */
  static readonly REFRESH_MS = 60_000;
  /** Coming back to the app re-checks too, if it's been at least this long. */
  static readonly RESUME_REFRESH_AFTER_MS = 15_000;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastRefreshAt = 0;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly pageFade = inject(PageFadeService);
  /** On screen: not asleep (left, kept alive) and the app not in the background. */
  private awake(): boolean {
    return document.visibilityState === 'visible' && onShowingPage(this.host);
  }
  private readonly onVisibilityChange = (): void => {
    if (!this.awake()) {
      return;
    }
    if (Date.now() - this.lastRefreshAt > HomePageComponent.RESUME_REFRESH_AFTER_MS) {
      this.refreshLibraryRows();
    } else {
      // Anything may have changed while away (scenes played, cleared, deleted).
      void this.loadContinueWatching();
    }
  };
  // A scene's place saved (watching it, leaving it, closing the miniplayer):
  // Continue Watching follows straight away, even while away (so it's right
  // the moment Home is back).
  private readonly progressWatch = inject(PlayerService).progressSaved.subscribe((id) => {
    this.savedLately = [id, ...this.savedLately.filter((other) => other !== id)];
    void this.loadContinueWatching();
  });
  private readonly clearingSettled = inject(WatchProgressService).settled.subscribe(
    () => void this.loadContinueWatching(),
  );
  // Marked unwatched (on a scene's page): out of Continue Watching at once,
  // which holds its own copy of everyone's progress.
  private readonly clearedWatch = inject(WatchProgressService).cleared.subscribe((ids) =>
    this.continueWatchingItems.update((items) => items.filter((item) => !ids.includes(item.id))),
  );
  // Back on Home after a while away (the page was kept, asleep): catch up.
  private readonly navigationWatch = inject(Router).events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      this.host.classList.remove('cw-live');
    } else if (event instanceof NavigationEnd && this.awake()) {
      this.onReturn();
    }
  });

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
    void this.pageSettled().then(() => {
      if (this.awake()) {
        this.host.classList.add('cw-live');
      }
    });
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
    this.discoverService
      .getPopularPerformers()
      .pipe(catchError(() => of({ items: [] as PerformerFeedItem[] })))
      .subscribe((response) => this.popularPerformers.set(response.items));
    this.discoverService
      .getPopularStudios()
      .pipe(catchError(() => of({ items: [] as StudioFeedItem[] })))
      .subscribe((response) => this.popularSites.set(response.items));
  }

  ngOnDestroy(): void {
    this.navigationWatch.unsubscribe();
    this.progressWatch.unsubscribe();
    this.clearedWatch.unsubscribe();
    this.clearingSettled.unsubscribe();
    if (this.arrivalTimer) {
      clearTimeout(this.arrivalTimer);
    }
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

  /** Shuffle: opens a scene from the library at random. */
  protected openRandomScene(): void {
    if (this.shuffling()) {
      return;
    }
    this.shuffling.set(true);
    this.libraryService
      .getRandomSceneId(this.lastRandomSceneId)
      .pipe(
        catchError(() => of({ id: null })),
        finalize(() => this.shuffling.set(false)),
      )
      .subscribe(({ id }) => {
        if (!id) {
          this.notifications.info('No scenes in the library yet.');
          return;
        }
        this.lastRandomSceneId = id;
        void this.router.navigate(['/library/scene', id], {
          queryParams: { returnTo: '/home' },
        });
      });
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
  }

  // Home's back on screen. Held back a moment for an up-to-date Continue
  // Watching, so that what's left it while away isn't seen going. Its leaving
  // animations are only for what goes once Home is settled.
  private onReturn(): void {
    const fresh = this.loadContinueWatching();
    if (Date.now() - this.lastRefreshAt > HomePageComponent.RESUME_REFRESH_AFTER_MS) {
      this.refreshLibraryRows();
    }
    this.pageFade.holdReveal(
      Promise.race([
        fresh,
        new Promise((resolve) => setTimeout(resolve, HomePageComponent.RETURN_HOLD_MAX_MS)),
      ]),
    );
    void this.pageSettled().then(() => {
      if (this.awake()) {
        this.host.classList.add('cw-live');
      }
    });
  }

  protected loadContinueWatching(): Promise<void> {
    this.continueWatchingSubscription?.unsubscribe();
    return new Promise((resolve) => {
      this.continueWatchingSubscription = this.homeService
        .getContinueWatching()
        // (A hiccup leaves the row as it is, rather than emptying it.)
        .pipe(
          catchError(() => EMPTY),
          finalize(resolve),
        )
        .subscribe((response) => {
          // Couldn't tell (Stash unreachable): the row stays as it is.
          if (response.message && response.items.length === 0) {
            return;
          }
          void this.showContinueWatching(response.items);
        });
    });
  }

  private async showContinueWatching(fetched: HomeRailItem[]): Promise<void> {
    const run = ++this.continueWatchingRun;
    const visible = () =>
      this.latestFirst(fetched.filter((item) => !this.watchProgress.isClearing(item.id)));
    const before = this.continueWatchingItems();
    // Away: what's gone goes, ready for coming back. What's new waits, to
    // arrive where it's seen.
    if (this.continueWatchingLoaded && !this.awake()) {
      const shown = new Set(before.map((item) => item.id));
      this.setIfChanged(
        this.continueWatchingItems,
        visible().filter((item) => shown.has(item.id)),
      );
      return;
    }
    const arrival = this.arrivalFor(before, visible());
    if (arrival) {
      // Ready first: its pictures there, the page done coming in.
      await Promise.all([this.preloadPictures(visible()), this.pageSettled()]);
      if (run !== this.continueWatchingRun) {
        return;
      }
    }
    const items = visible();
    this.setIfChanged(this.continueWatchingItems, items);
    this.continueWatchingLoaded = true;
    if (arrival) {
      this.playArrival(arrival, items[0]?.id ?? null);
    }
  }

  // Not on first opening Home. The first scene in the row: the section comes
  // in. Another at the front: the row slides over to make room.
  private arrivalFor(before: HomeRailItem[], items: HomeRailItem[]): 'section' | 'card' | null {
    if (!this.continueWatchingLoaded || items.length === 0 || !this.awake()) {
      return null;
    }
    if (before.length === 0) {
      return 'section';
    }
    return items[0]?.id === before[0]?.id ? null : 'card';
  }

  /** The pictures that will show first, decoded so they appear whole (not for too long). */
  private preloadPictures(items: HomeRailItem[]): Promise<unknown> {
    const pictures = items
      .slice(0, 3)
      .flatMap((item) => (item.cardImageUrl ? [item.cardImageUrl] : []))
      .map((url) => {
        const image = new Image();
        image.src = url;
        return typeof image.decode === 'function' ? image.decode().catch(() => undefined) : null;
      });
    return Promise.race([
      Promise.all(pictures),
      new Promise((resolve) => setTimeout(resolve, HomePageComponent.PRELOAD_MAX_MS)),
    ]);
  }

  /** Coming back to Home, it's fading in: wait for that, so the two don't overlap. */
  private pageSettled(): Promise<void> {
    const deadline = Date.now() + HomePageComponent.SETTLE_MAX_MS;
    return new Promise((resolve) => {
      const check = () => {
        const moving = this.host.closest('.is-pending, .is-entering');
        if (!moving || Date.now() > deadline) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }

  // What's been watched in this visit leads the row, however Stash orders it.
  private continueWatchingSection(): HTMLElement | null {
    return this.host.querySelector<HTMLElement>('[data-testid="continue-watching"]');
  }

  private latestFirst(items: HomeRailItem[]): HomeRailItem[] {
    const lately = this.savedLately.flatMap((id) => items.filter((item) => item.id === id));
    return [...lately, ...items.filter((item) => !this.savedLately.includes(item.id))];
  }

  private playArrival(kind: 'section' | 'card', front: string | null): void {
    if (kind === 'card') {
      // The new one's at the start: that's where to be.
      // (Once it's in: scroll snapping otherwise stays with the old first card.)
      afterNextRender(
        () =>
          this.railViewports
            ?.find((viewport) => viewport.nativeElement.dataset['railId'] === 'continue-watching')
            ?.nativeElement.scrollTo({ left: 0, behavior: 'instant' }),
        { injector: this.injector },
      );
    }
    this.continueWatchingArriving.set(kind);
    this.continueWatchingFront.set(front);
    if (kind === 'section') {
      // Off screen, the browser keeps the page steady by itself: moving the
      // rows as well would be a jump.
      afterNextRender(
        () => {
          const rect = this.continueWatchingSection()?.getBoundingClientRect();
          if (!rect || rect.top > window.innerHeight || rect.bottom < 0) {
            this.continueWatchingArriving.set(null);
          }
        },
        { injector: this.injector },
      );
    }
    if (this.arrivalTimer) {
      clearTimeout(this.arrivalTimer);
    }
    this.arrivalTimer = setTimeout(() => {
      this.continueWatchingArriving.set(null);
      this.continueWatchingFront.set(null);
    }, HomePageComponent.ARRIVAL_MS);
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
    // At once, not waiting for the server (it's back if that fails).
    this.continueWatchingItems.update((items) => items.filter((item) => item.id !== localSceneId));
    this.homeService.resetContinueWatchingProgress(localSceneId).subscribe({
      error: () => void this.loadContinueWatching(),
      next: () => {
        // Its other cards, on Home and elsewhere.
        this.watchProgress.refresh();
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
