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
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { ToggleSwitch } from 'primeng/toggleswitch';
import {
  Observable,
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  forkJoin,
  of,
  switchMap,
} from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import {
  PerformerFeedItem,
  PerformerFeedResponse,
  SceneExplorerItem,
  SceneRequestContext,
  ScenesFeedResponse,
  StudioFeedItem,
  StudioFeedResponse,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { PlayerService } from '../../core/player/player.service';
import { SceneCardComponent } from '../../shared/scene-card/scene-card.component';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';

import { Reveal, RowReveal, tilesPerRow } from '../../shared/show-more/reveal';

import { LogoContrastDirective } from '../../shared/logo-contrast/logo-contrast.directive';
@Component({
  selector: 'app-search-page',
  imports: [
    LogoContrastDirective,
    FormsModule,
    RouterLink,
    ProgressSpinner,
    ToggleSwitch,
    SceneCardComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss',
})
export class SearchPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly RESULTS_PER_SOURCE = 24;

  private readonly discoverService = inject(DiscoverService);
  private readonly sceneQuickRequestService = inject(SceneQuickRequestService);
  private readonly playerService = inject(PlayerService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly searchTerms = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private queryParamSubscription: Subscription | null = null;

  protected readonly queryInput = signal('');
  protected readonly loading = signal(false);
  protected readonly searched = signal(false);
  protected readonly sceneResults = signal<SceneExplorerItem[]>([]);
  protected readonly performerResults = signal<PerformerFeedItem[]>([]);
  protected readonly studioResults = signal<StudioFeedItem[]>([]);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly favoritePerformersOnly = signal(false);
  // A row of performers and of sites (as many as fit), 5 scenes at first, then more on request.
  protected readonly performersShown = new RowReveal(1, 2);
  protected readonly studiosShown = new RowReveal(1, 2);
  // Performers and sites: as many as fit in a row (4, 6 or 8).
  protected readonly perRow = tilesPerRow();
  protected readonly scenesShown = new Reveal(5, 10);

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  // Opened from the search icon: straight into typing (the keyboard is
  // already up -- the icon tap focused a stand-in that this takes over from).
  // Kept alive, the page is often brought back rather than made: then too.
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly returnWatch = this.router.events
    .pipe(filter((event) => event instanceof NavigationEnd))
    .subscribe(() => {
      if (this.host.isConnected) {
        this.focusIfAsked();
      }
    });

  ngAfterViewInit(): void {
    this.focusIfAsked();
  }

  private focusIfAsked(): void {
    if ((history.state as { focusSearch?: boolean } | null)?.focusSearch) {
      this.searchInput?.nativeElement.focus({ preventScroll: true });
    }
  }

  ngOnInit(): void {
    this.setupSearch();
    this.queryParamSubscription = this.route.queryParamMap.subscribe((params) => {
      const query = params.get('q')?.trim() ?? '';
      if (query === this.queryInput()) {
        return;
      }

      this.queryInput.set(query);
      this.searchTerms.next(query);
    });
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.queryParamSubscription?.unsubscribe();
    this.returnWatch.unsubscribe();
  }

  protected onQueryInput(value: string): void {
    this.queryInput.set(value);
    this.searchTerms.next(value);
  }

  protected onQuerySubmit(): void {
    this.syncUrl(this.queryInput().trim());
  }

  protected onFavoritePerformersOnlyChanged(nextValue: boolean): void {
    if (this.favoritePerformersOnly() === nextValue) {
      return;
    }

    this.favoritePerformersOnly.set(nextValue);
    // Bypass the debounced/distinct searchTerms pipeline: the query text
    // hasn't changed, only the filter, so distinctUntilChanged would
    // otherwise swallow this.
    this.runSearch(this.queryInput().trim());
  }

  protected hasResults(): boolean {
    return (
      this.sceneResults().length > 0 ||
      this.performerResults().length > 0 ||
      this.studioResults().length > 0
    );
  }

  protected isRequestable(item: SceneExplorerItem): boolean {
    return item.requestable && isSceneStatusRequestable(item.status);
  }

  protected playScene(stashId: string): void {
    const item = this.sceneResults().find((item) => item.id === stashId);
    this.playerService.openByCatalogSceneId({
      title: item?.title ?? 'Scene',
      catalogStashId: stashId,
      imageUrl: item?.cardImageUrl ?? item?.imageUrl,
      details: {
        studio: item?.studio ?? null,
        studioImageUrl: item?.studioImageUrl ?? null,
        releaseDate: item?.releaseDate ?? null,
        description: item?.description ?? null,
        detailsLink: { commands: ['/scene', stashId] },
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
    this.sceneResults.update((items) =>
      items.map((item) =>
        item.id === stashId
          ? { ...item, requestable: false, status: { state: 'REQUESTED' } }
          : item,
      ),
    );
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  private syncUrl(query: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: query.length > 0 ? query : null },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  }

  private setupSearch(): void {
    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => this.searchFor(term.trim())),
      )
      .subscribe((result) => this.applySearchResult(result));
  }

  private runSearch(query: string): void {
    this.searchFor(query).subscribe((result) => this.applySearchResult(result));
  }

  private searchFor(
    query: string,
  ): Observable<{
    scenes: ScenesFeedResponse;
    performers: PerformerFeedResponse;
    studios: StudioFeedResponse;
  } | null> {
    this.searched.set(query.length > 0);
    if (!query) {
      return of(null);
    }

    const emptyScenes: ScenesFeedResponse = {
      total: 0,
      page: 1,
      perPage: SearchPageComponent.RESULTS_PER_SOURCE,
      hasMore: false,
      items: [] as SceneExplorerItem[],
    };
    const emptyPerformers: PerformerFeedResponse = {
      total: 0,
      page: 1,
      perPage: SearchPageComponent.RESULTS_PER_SOURCE,
      hasMore: false,
      items: [] as PerformerFeedItem[],
    };
    const emptyStudios: StudioFeedResponse = {
      total: 0,
      page: 1,
      perPage: SearchPageComponent.RESULTS_PER_SOURCE,
      hasMore: false,
      items: [] as StudioFeedItem[],
    };

    this.loading.set(true);
    return forkJoin({
      scenes: this.discoverService
        .getScenesFeed(
          1,
          SearchPageComponent.RESULTS_PER_SOURCE,
          'TITLE',
          'ASC',
          [],
          undefined,
          undefined,
          [],
          query,
        )
        .pipe(catchError(() => of(emptyScenes))),
      performers: this.discoverService
        .getPerformersFeed(1, SearchPageComponent.RESULTS_PER_SOURCE, {
          name: query,
          favoritesOnly: this.favoritePerformersOnly(),
        })
        .pipe(catchError(() => of(emptyPerformers))),
      studios: this.discoverService
        .getStudiosFeed(1, SearchPageComponent.RESULTS_PER_SOURCE, { name: query })
        .pipe(catchError(() => of(emptyStudios))),
    }).pipe(finalize(() => this.loading.set(false)));
  }

  private applySearchResult(
    result: {
      scenes: ScenesFeedResponse;
      performers: PerformerFeedResponse;
      studios: StudioFeedResponse;
    } | null,
  ): void {
    this.performersShown.reset();
    this.studiosShown.reset();
    this.scenesShown.reset();
    if (!result) {
      this.sceneResults.set([]);
      this.performerResults.set([]);
      this.studioResults.set([]);
      return;
    }

    this.sceneResults.set(result.scenes.items);
    this.performerResults.set(result.performers.items);
    this.studioResults.set(result.studios.items);
  }
}
