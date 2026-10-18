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
import { RouterLink } from '@angular/router';
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
import { ActivatedRoute, Router } from '@angular/router';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import {
  PerformerFeedItem,
  PerformerFeedResponse,
  PerformerGender,
  PerformerSort,
  SortDirection,
} from '../../core/api/discover.types';

/** The page's orders: the catalog's, and ThePornDB website's popular performers. */
type PerformerPageSort = PerformerSort | 'POPULAR';

type GenderOption = PerformerGender | 'NONE';

@Component({
  selector: 'app-performers-page',
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
  templateUrl: './performers-page.component.html',
  styleUrl: './performers-page.component.scss',
})
export class PerformersPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 24;
  private static readonly NAME_FILTER_DEBOUNCE_MS = 300;
  private static readonly DEFAULT_SORT: PerformerPageSort = 'POPULAR';
  private static readonly DEFAULT_DIRECTION: SortDirection = 'ASC';
  private static readonly DEFAULT_GENDER: GenderOption = 'NONE';

  protected static readonly SORT_OPTIONS: Array<{
    value: PerformerPageSort;
    label: string;
  }> = [
    { value: 'POPULAR', label: 'Popular' },
    { value: 'NAME', label: 'Name' },
    { value: 'BIRTHDATE', label: 'Birthdate' },
    { value: 'SCENE_COUNT', label: 'Scene Count' },
    { value: 'CAREER_START_YEAR', label: 'Career Start Year' },
    { value: 'DEBUT', label: 'Debut' },
    { value: 'LAST_SCENE', label: 'Last Scene' },
    { value: 'CREATED_AT', label: 'Created At' },
    { value: 'UPDATED_AT', label: 'Updated At' },
  ];

  protected static readonly GENDER_OPTIONS: Array<{
    value: GenderOption;
    label: string;
  }> = [
    { value: 'NONE', label: 'Any Gender' },
    { value: 'FEMALE', label: 'Female' },
    { value: 'MALE', label: 'Male' },
    { value: 'NON_BINARY', label: 'Non-Binary' },
    { value: 'TRANSGENDER_FEMALE', label: 'Transgender Female' },
    { value: 'TRANSGENDER_MALE', label: 'Transgender Male' },
    { value: 'INTERSEX', label: 'Intersex' },
    { value: 'UNKNOWN', label: 'Unknown' },
  ];

  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly nameFilterTerms = new Subject<string>();
  /** The website's popular performers aren't available: Popular lists by name. */
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
  protected readonly items = signal<PerformerFeedItem[]>([]);
  protected readonly nameFilter = signal('');
  protected readonly selectedGender = signal<GenderOption>(PerformersPageComponent.DEFAULT_GENDER);
  protected readonly selectedSort = signal<PerformerPageSort>(PerformersPageComponent.DEFAULT_SORT);
  protected readonly selectedDirection = signal<SortDirection>(
    PerformersPageComponent.DEFAULT_DIRECTION,
  );
  protected readonly favoritesOnly = signal(false);
  protected readonly favoriteInFlightById = signal<Record<string, boolean>>({});
  protected readonly sortOptions = PerformersPageComponent.SORT_OPTIONS;
  protected readonly genderOptions = PerformersPageComponent.GENDER_OPTIONS;

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
      this.selectedGender() !== PerformersPageComponent.DEFAULT_GENDER ||
      this.selectedSort() !== PerformersPageComponent.DEFAULT_SORT ||
      this.selectedDirection() !== PerformersPageComponent.DEFAULT_DIRECTION ||
      this.favoritesOnly()
    );
  }

  protected clearFilters(): void {
    if (!this.hasFilters()) {
      return;
    }
    this.nameFilter.set('');
    this.selectedGender.set(PerformersPageComponent.DEFAULT_GENDER);
    this.selectedSort.set(PerformersPageComponent.DEFAULT_SORT);
    this.selectedDirection.set(PerformersPageComponent.DEFAULT_DIRECTION);
    this.favoritesOnly.set(false);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected onNameFilterChanged(nextValue: string): void {
    this.nameFilter.set(nextValue);
    this.syncUrlWithCurrentFilters(true);
    this.nameFilterTerms.next(nextValue);
  }

  protected onGenderChanged(nextValue: string): void {
    if (
      nextValue === 'NONE' ||
      nextValue === 'MALE' ||
      nextValue === 'FEMALE' ||
      nextValue === 'UNKNOWN' ||
      nextValue === 'TRANSGENDER_MALE' ||
      nextValue === 'TRANSGENDER_FEMALE' ||
      nextValue === 'INTERSEX' ||
      nextValue === 'NON_BINARY'
    ) {
      if (this.selectedGender() === nextValue) {
        return;
      }

      this.selectedGender.set(nextValue);
      this.syncUrlWithCurrentFilters(false);
      this.resetFeedAndReload();
    }
  }

  protected onSortChanged(nextValue: string): void {
    if (
      nextValue === 'POPULAR' ||
      nextValue === 'NAME' ||
      nextValue === 'BIRTHDATE' ||
      nextValue === 'SCENE_COUNT' ||
      nextValue === 'CAREER_START_YEAR' ||
      nextValue === 'DEBUT' ||
      nextValue === 'LAST_SCENE' ||
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

  protected performerInitial(name: string): string {
    return name.trim().charAt(0).toUpperCase();
  }

  protected formattedGender(gender: PerformerGender | null): string | null {
    if (!gender) {
      return null;
    }

    return gender
      .split('_')
      .map((token) => token.charAt(0) + token.slice(1).toLowerCase())
      .join(' ');
  }

  protected favoriteToggleLabel(isFavorite: boolean): string {
    return isFavorite ? 'Unfavorite performer' : 'Favorite performer';
  }

  protected favoriteToggleBusy(performerId: string): boolean {
    return this.favoriteInFlightById()[performerId] === true;
  }

  protected togglePerformerFavorite(event: Event, performer: PerformerFeedItem): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.favoriteToggleBusy(performer.id)) {
      return;
    }

    const nextFavorite = !performer.isFavorite;
    this.setFavoriteToggleBusy(performer.id, true);

    this.discoverService
      .favoritePerformer(performer.id, nextFavorite)
      .pipe(
        finalize(() => {
          this.setFavoriteToggleBusy(performer.id, false);
        }),
      )
      .subscribe({
        next: (result) => {
          if (this.favoritesOnly() && !nextFavorite) {
            this.resetFeedAndReload();
          } else {
            this.items.update((current) =>
              current.map((item) =>
                item.id === performer.id ? { ...item, isFavorite: nextFavorite } : item,
              ),
            );
          }

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

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  /**
   * A page of performers. Popular (the default): ThePornDB website's popular
   * performers, all at once, the gender and favourites filters applied to
   * them -- or, searching by name or with no website login, the catalog's
   * list by name. Otherwise the catalog's list in the order chosen.
   */
  private performersPage(page: number): Observable<PerformerFeedResponse> {
    const sort = this.selectedSort();
    const feed = (by: PerformerSort) =>
      this.discoverService.getPerformersFeed(page, PerformersPageComponent.PAGE_SIZE, {
        name: this.normalizedNameFilter(),
        gender: this.selectedGenderFilter(),
        sort: by,
        direction: sort === 'POPULAR' ? 'ASC' : this.selectedDirection(),
        favoritesOnly: this.favoritesOnly(),
      });
    if (sort !== 'POPULAR') {
      return feed(sort);
    }
    if (this.normalizedNameFilter()) {
      return feed('NAME');
    }
    if (this.popularUnavailable) {
      return feed('NAME');
    }
    const gender = this.selectedGenderFilter();
    const favoritesOnly = this.favoritesOnly();
    return this.discoverService.getPopularPerformers().pipe(
      switchMap((popular) => {
        if (popular.items.length === 0) {
          // No website login (or nothing read yet): by name instead.
          this.popularUnavailable = true;
          return feed('NAME');
        }
        const items = popular.items.filter(
          (performer) =>
            (!gender || performer.gender === gender) && (!favoritesOnly || performer.isFavorite),
        );
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

    this.performersPage(nextPage)
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
            this.error.set('Failed to load performers feed from the API.');
          } else {
            this.loadMoreError.set('Failed to load more performers.');
          }
        },
      });
  }

  private normalizedNameFilter(): string | undefined {
    const normalizedName = this.nameFilter().trim();
    return normalizedName.length > 0 ? normalizedName : undefined;
  }

  private selectedGenderFilter(): PerformerGender | undefined {
    const gender = this.selectedGender();
    return gender === 'NONE' ? undefined : gender;
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
    gender: GenderOption;
    sort: PerformerPageSort;
    direction: SortDirection;
    favoritesOnly: boolean;
  } {
    const name = (queryParamMap.get('q') ?? '').trim();

    const genderParam = queryParamMap.get('gender');
    const gender: GenderOption =
      genderParam === 'NONE' ||
      genderParam === 'MALE' ||
      genderParam === 'FEMALE' ||
      genderParam === 'UNKNOWN' ||
      genderParam === 'TRANSGENDER_MALE' ||
      genderParam === 'TRANSGENDER_FEMALE' ||
      genderParam === 'INTERSEX' ||
      genderParam === 'NON_BINARY'
        ? genderParam
        : PerformersPageComponent.DEFAULT_GENDER;

    const sortParam = queryParamMap.get('sort');
    const sort: PerformerPageSort =
      sortParam === 'POPULAR' ||
      sortParam === 'NAME' ||
      sortParam === 'BIRTHDATE' ||
      sortParam === 'SCENE_COUNT' ||
      sortParam === 'CAREER_START_YEAR' ||
      sortParam === 'DEBUT' ||
      sortParam === 'LAST_SCENE' ||
      sortParam === 'CREATED_AT' ||
      sortParam === 'UPDATED_AT'
        ? sortParam
        : PerformersPageComponent.DEFAULT_SORT;

    const favoritesOnlyParam = queryParamMap.get('fav');
    const favoritesOnly = favoritesOnlyParam === '1' || favoritesOnlyParam === 'true';
    const directionParam = queryParamMap.get('dir');
    const direction: SortDirection =
      directionParam === 'ASC' || directionParam === 'DESC'
        ? directionParam
        : PerformersPageComponent.DEFAULT_DIRECTION;

    return {
      name,
      gender,
      sort,
      direction,
      favoritesOnly,
    };
  }

  private applyUrlState(state: {
    name: string;
    gender: GenderOption;
    sort: PerformerPageSort;
    direction: SortDirection;
    favoritesOnly: boolean;
  }): boolean {
    const changed =
      this.nameFilter() !== state.name ||
      this.selectedGender() !== state.gender ||
      this.selectedSort() !== state.sort ||
      this.selectedDirection() !== state.direction ||
      this.favoritesOnly() !== state.favoritesOnly;

    if (!changed) {
      return false;
    }

    this.nameFilter.set(state.name);
    this.selectedGender.set(state.gender);
    this.selectedSort.set(state.sort);
    this.selectedDirection.set(state.direction);
    this.favoritesOnly.set(state.favoritesOnly);
    return true;
  }

  private syncUrlWithCurrentFilters(replaceUrl: boolean): void {
    const normalizedName = this.nameFilter().trim();
    const next = {
      q: normalizedName.length > 0 ? normalizedName : null,
      gender:
        this.selectedGender() === PerformersPageComponent.DEFAULT_GENDER
          ? null
          : this.selectedGender(),
      sort:
        this.selectedSort() === PerformersPageComponent.DEFAULT_SORT ? null : this.selectedSort(),
      dir:
        this.selectedDirection() === PerformersPageComponent.DEFAULT_DIRECTION
          ? null
          : this.selectedDirection(),
      fav: this.favoritesOnly() ? '1' : null,
    };

    const current = this.route.snapshot.queryParamMap;
    if (
      (current.get('q') ?? null) === next.q &&
      (current.get('gender') ?? null) === next.gender &&
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
        debounceTime(PerformersPageComponent.NAME_FILTER_DEBOUNCE_MS),
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

  private setFavoriteToggleBusy(performerId: string, busy: boolean): void {
    this.favoriteInFlightById.update((current) => {
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
