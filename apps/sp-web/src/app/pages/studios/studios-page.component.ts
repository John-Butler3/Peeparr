import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Observable,
  Subject,
  Subscription,
  debounceTime,
  filter,
  finalize,
  of,
  switchMap,
} from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import {
  SortDirection,
  StudioFeedItem,
  StudioFeedResponse,
  StudioFeedSort,
} from '../../core/api/discover.types';

/** The page's orders: the catalog's, and ThePornDB website's popular sites. */
type StudioPageSort = StudioFeedSort | 'POPULAR';

@Component({
  selector: 'app-studios-page',
  imports: [
    RouterLink,
    FormsModule,
    InputText,
    Message,
    ProgressSpinner,
    Select,
    ToggleSwitch,
    ButtonDirective,
  ],
  templateUrl: './studios-page.component.html',
  styleUrl: './studios-page.component.scss',
})
export class StudiosPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 24;
  private static readonly NAME_FILTER_DEBOUNCE_MS = 300;
  private static readonly DEFAULT_SORT: StudioPageSort = 'POPULAR';
  private static readonly DEFAULT_DIRECTION: SortDirection = 'ASC';

  protected static readonly SORT_OPTIONS: Array<{
    value: StudioPageSort;
    label: string;
  }> = [
    { value: 'POPULAR', label: 'Popular' },
    { value: 'NAME', label: 'Name' },
    { value: 'CREATED_AT', label: 'Created At' },
    { value: 'UPDATED_AT', label: 'Updated At' },
  ];

  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly nameFilterTerms = new Subject<string>();
  /** The website's popular sites aren't available: Popular lists by name. */
  private popularUnavailable = false;
  /** The name filter the feed was last loaded with. */
  private loadedName = '';
  private nameFilterSubscription: Subscription | null = null;
  private queryParamSubscription: Subscription | null = null;
  private observer: IntersectionObserver | null = null;
  private sentinelElement: HTMLDivElement | null = null;
  private sentinelIntersecting = false;
  private feedVersion = 0;
  private pendingReload = false;
  private hasHydratedFromUrl = false;

  @ViewChild('loadMoreSentinel')
  set loadMoreSentinel(elementRef: ElementRef<HTMLDivElement> | undefined) {
    const nextElement = elementRef?.nativeElement ?? null;
    if (this.sentinelElement === nextElement) {
      return;
    }

    if (this.observer && this.sentinelElement) {
      this.observer.unobserve(this.sentinelElement);
    }

    this.sentinelElement = nextElement;

    if (this.observer && this.sentinelElement) {
      this.observer.observe(this.sentinelElement);
    }
  }

  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadMoreError = signal<string | null>(null);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly hasMore = signal(true);
  protected readonly inFlight = signal(false);
  protected readonly items = signal<StudioFeedItem[]>([]);
  protected readonly nameFilter = signal('');
  protected readonly selectedSort = signal<StudioPageSort>(StudiosPageComponent.DEFAULT_SORT);
  protected readonly selectedDirection = signal<SortDirection>(
    StudiosPageComponent.DEFAULT_DIRECTION,
  );
  protected readonly favoritesOnly = signal(false);
  protected readonly favoriteInFlightById = signal<Record<string, boolean>>({});
  protected readonly sortOptions = StudiosPageComponent.SORT_OPTIONS;

  ngOnInit(): void {
    this.setupNameFilterDebounce();
    this.setupUrlStateSync();
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    if (this.observer && this.sentinelElement) {
      this.observer.unobserve(this.sentinelElement);
    }
    this.observer?.disconnect();
    this.nameFilterSubscription?.unsubscribe();
    this.queryParamSubscription?.unsubscribe();
  }

  protected hasItems(): boolean {
    return this.items().length > 0;
  }

  protected retryInitialLoad(): void {
    if (this.inFlight()) {
      return;
    }

    this.error.set(null);
    this.loadNextPage();
  }

  protected retryLoadMore(): void {
    if (this.inFlight() || !this.hasMore()) {
      return;
    }

    this.loadMoreError.set(null);
    this.loadNextPage();
  }

  /** Any filter or sort away from the defaults. */
  protected hasFilters(): boolean {
    return (
      this.nameFilter().trim().length > 0 ||
      this.selectedSort() !== StudiosPageComponent.DEFAULT_SORT ||
      this.selectedDirection() !== StudiosPageComponent.DEFAULT_DIRECTION ||
      this.favoritesOnly()
    );
  }

  protected clearFilters(): void {
    if (!this.hasFilters()) {
      return;
    }
    this.nameFilter.set('');
    this.selectedSort.set(StudiosPageComponent.DEFAULT_SORT);
    this.selectedDirection.set(StudiosPageComponent.DEFAULT_DIRECTION);
    this.favoritesOnly.set(false);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected onNameFilterChanged(nextValue: string): void {
    this.nameFilter.set(nextValue);
    this.syncUrlWithCurrentFilters(true);
    this.nameFilterTerms.next(nextValue);
  }

  protected onSortChanged(nextValue: string): void {
    if (
      nextValue === 'POPULAR' ||
      nextValue === 'NAME' ||
      nextValue === 'CREATED_AT' ||
      nextValue === 'UPDATED_AT'
    ) {
      if (this.selectedSort() === nextValue) {
        return;
      }

      this.selectedSort.set(nextValue);
      this.syncUrlWithCurrentFilters(false);
      this.resetFeedAndReload();
    }
  }

  protected onDirectionChanged(nextValue: string): void {
    if (nextValue !== 'ASC' && nextValue !== 'DESC') {
      return;
    }

    if (this.selectedDirection() === nextValue) {
      return;
    }

    this.selectedDirection.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected toggleSortDirection(): void {
    this.onDirectionChanged(this.selectedDirection() === 'ASC' ? 'DESC' : 'ASC');
  }

  protected sortDirectionIconClass(): string {
    return this.selectedDirection() === 'ASC'
      ? 'pi pi-sort-amount-up-alt'
      : 'pi pi-sort-amount-down-alt';
  }

  protected sortDirectionToggleLabel(): string {
    return this.selectedDirection() === 'ASC'
      ? 'Sort direction: ascending. Toggle to descending.'
      : 'Sort direction: descending. Toggle to ascending.';
  }

  protected onFavoritesOnlyChanged(nextValue: boolean): void {
    if (this.favoritesOnly() === nextValue) {
      return;
    }

    this.favoritesOnly.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected studioInitial(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
  }

  protected favoriteToggleLabel(isFavorite: boolean): string {
    return isFavorite ? 'Unfavorite studio' : 'Favorite studio';
  }

  protected favoriteToggleBusy(studioId: string): boolean {
    return this.favoriteInFlightById()[studioId] === true;
  }

  protected toggleStudioFavorite(event: Event, studio: StudioFeedItem): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.favoriteToggleBusy(studio.id)) {
      return;
    }

    const nextFavorite = !studio.isFavorite;
    this.setFavoriteToggleBusy(studio.id, true);

    this.discoverService
      .favoriteStudio(studio.id, nextFavorite)
      .pipe(
        finalize(() => {
          this.setFavoriteToggleBusy(studio.id, false);
        }),
      )
      .subscribe({
        next: (result) => {
          if (this.favoritesOnly() && !nextFavorite) {
            this.resetFeedAndReload();
          } else {
            this.items.update((current) =>
              current.map((item) =>
                item.id === studio.id ? { ...item, isFavorite: nextFavorite } : item,
              ),
            );
          }

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

  protected childStudiosPreview(item: StudioFeedItem): string[] {
    return item.childStudios.slice(0, 3).map((child) => child.name);
  }

  protected childStudiosOverflowCount(item: StudioFeedItem): number {
    const overflow = item.childStudios.length - 3;
    return overflow > 0 ? overflow : 0;
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  /**
   * A page of sites. Popular (the default): ThePornDB website's popular
   * sites, all at once, the favourites filter applied to them -- or,
   * searching by name or with no website login, the catalog's list by name.
   * Otherwise the catalog's list in the order chosen.
   */
  private studiosPage(page: number): Observable<StudioFeedResponse> {
    const sort = this.selectedSort();
    const feed = (by: StudioFeedSort) =>
      this.discoverService.getStudiosFeed(page, StudiosPageComponent.PAGE_SIZE, {
        name: this.normalizedNameFilter(),
        sort: by,
        direction: sort === 'POPULAR' ? 'ASC' : this.selectedDirection(),
        favoritesOnly: this.favoritesOnly(),
      });
    if (sort !== 'POPULAR') {
      return feed(sort);
    }
    if (this.normalizedNameFilter() || this.popularUnavailable) {
      return feed('NAME');
    }
    const favoritesOnly = this.favoritesOnly();
    return this.discoverService.getPopularStudios().pipe(
      switchMap((popular) => {
        if (popular.items.length === 0) {
          // No website login (or nothing read yet): by name instead.
          this.popularUnavailable = true;
          return feed('NAME');
        }
        const items = popular.items.filter((site) => !favoritesOnly || site.isFavorite);
        return of({ total: items.length, page: 1, perPage: items.length, hasMore: false, items });
      }),
    );
  }

  private loadNextPage(): void {
    if (this.inFlight() || !this.hasMore()) {
      return;
    }

    const nextPage = this.page() + 1;
    const isInitialPage = nextPage === 1;
    const requestVersion = this.feedVersion;
    this.inFlight.set(true);

    if (isInitialPage) {
      this.loading.set(true);
      this.error.set(null);
    } else {
      this.loadingMore.set(true);
      this.loadMoreError.set(null);
    }

    this.studiosPage(nextPage)
      .pipe(
        finalize(() => {
          this.inFlight.set(false);

          if (requestVersion !== this.feedVersion) {
            if (this.pendingReload) {
              this.pendingReload = false;
              this.loadNextPage();
            }
            return;
          }

          if (isInitialPage) {
            this.loading.set(false);
          } else {
            this.loadingMore.set(false);
          }

          if (this.sentinelIntersecting && this.hasMore()) {
            this.loadNextPage();
          }
        }),
      )
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.feedVersion) {
            return;
          }

          this.total.set(response.total);
          this.page.set(response.page);
          this.hasMore.set(response.hasMore);
          this.items.update((current) =>
            isInitialPage ? response.items : [...current, ...response.items],
          );
        },
        error: () => {
          if (requestVersion !== this.feedVersion) {
            return;
          }

          if (isInitialPage) {
            this.error.set('Failed to load studios feed from the API.');
          } else {
            this.loadMoreError.set('Failed to load more studios.');
          }
        },
      });
  }

  private normalizedNameFilter(): string | undefined {
    const normalizedName = this.nameFilter().trim();
    return normalizedName.length > 0 ? normalizedName : undefined;
  }

  private setupUrlStateSync(): void {
    this.queryParamSubscription = this.route.queryParamMap.subscribe((queryParamMap) => {
      const urlState = this.readUrlState(queryParamMap);
      const changed = this.applyUrlState(urlState);
      if (!this.hasHydratedFromUrl || changed) {
        this.hasHydratedFromUrl = true;
        this.resetFeedAndReload();
        return;
      }

      this.hasHydratedFromUrl = true;
    });
  }

  private readUrlState(queryParamMap: import('@angular/router').ParamMap): {
    name: string;
    sort: StudioPageSort;
    direction: SortDirection;
    favoritesOnly: boolean;
  } {
    const name = (queryParamMap.get('q') ?? '').trim();

    const sortParam = queryParamMap.get('sort');
    const sort: StudioPageSort =
      sortParam === 'POPULAR' ||
      sortParam === 'NAME' ||
      sortParam === 'CREATED_AT' ||
      sortParam === 'UPDATED_AT'
        ? sortParam
        : StudiosPageComponent.DEFAULT_SORT;
    const directionParam = queryParamMap.get('dir');
    const direction: SortDirection =
      directionParam === 'ASC' || directionParam === 'DESC'
        ? directionParam
        : StudiosPageComponent.DEFAULT_DIRECTION;

    const favoritesOnlyParam = queryParamMap.get('fav');
    const favoritesOnly = favoritesOnlyParam === '1' || favoritesOnlyParam === 'true';

    return {
      name,
      sort,
      direction,
      favoritesOnly,
    };
  }

  private applyUrlState(state: {
    name: string;
    sort: StudioPageSort;
    direction: SortDirection;
    favoritesOnly: boolean;
  }): boolean {
    const changed =
      this.nameFilter() !== state.name ||
      this.selectedSort() !== state.sort ||
      this.selectedDirection() !== state.direction ||
      this.favoritesOnly() !== state.favoritesOnly;

    if (!changed) {
      return false;
    }

    this.nameFilter.set(state.name);
    this.selectedSort.set(state.sort);
    this.selectedDirection.set(state.direction);
    this.favoritesOnly.set(state.favoritesOnly);
    return true;
  }

  private syncUrlWithCurrentFilters(replaceUrl: boolean): void {
    const normalizedName = this.nameFilter().trim();
    const next = {
      q: normalizedName.length > 0 ? normalizedName : null,
      sort: this.selectedSort() === StudiosPageComponent.DEFAULT_SORT ? null : this.selectedSort(),
      dir:
        this.selectedDirection() === StudiosPageComponent.DEFAULT_DIRECTION
          ? null
          : this.selectedDirection(),
      fav: this.favoritesOnly() ? '1' : null,
    };

    const current = this.route.snapshot.queryParamMap;
    if (
      (current.get('q') ?? null) === next.q &&
      (current.get('sort') ?? null) === next.sort &&
      (current.get('dir') ?? null) === next.dir &&
      (current.get('fav') ?? null) === next.fav
    ) {
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: next,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  private resetFeedAndReload(): void {
    this.feedVersion += 1;
    this.loadedName = this.nameFilter().trim();
    this.pendingReload = false;
    this.page.set(0);
    this.total.set(0);
    this.hasMore.set(true);
    this.items.set([]);
    this.loading.set(false);
    this.loadingMore.set(false);
    this.error.set(null);
    this.loadMoreError.set(null);

    if (this.inFlight()) {
      this.pendingReload = true;
      return;
    }

    this.loadNextPage();
  }

  private setupNameFilterDebounce(): void {
    this.nameFilterSubscription = this.nameFilterTerms
      .pipe(
        debounceTime(StudiosPageComponent.NAME_FILTER_DEBOUNCE_MS),
        // Only when it differs from the name loaded (cleared by Clear filters: already loaded).
        filter((term) => term.trim() !== this.loadedName),
      )
      .subscribe(() => {
        this.resetFeedAndReload();
      });
  }

  private setupIntersectionObserver(): void {
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          const [entry] = entries;
          if (!entry) {
            return;
          }

          this.sentinelIntersecting = entry.isIntersecting;
          if (!entry.isIntersecting) {
            return;
          }

          if (this.inFlight() || !this.hasMore()) {
            return;
          }

          this.loadNextPage();
        },
        {
          root: null,
          rootMargin: '300px 0px',
          threshold: 0.01,
        },
      );
    }

    if (this.sentinelElement) {
      this.observer.observe(this.sentinelElement);
    }
  }

  private setFavoriteToggleBusy(studioId: string, busy: boolean): void {
    this.favoriteInFlightById.update((current) => {
      if (busy) {
        return {
          ...current,
          [studioId]: true,
        };
      }

      const next = { ...current };
      delete next[studioId];
      return next;
    });
  }
}
