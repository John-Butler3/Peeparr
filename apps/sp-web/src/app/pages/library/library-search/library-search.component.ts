import { Component, Input, OnDestroy, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  merge,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { LibraryService } from '../../../core/api/library.service';
import {
  LibrarySceneItem,
  LibrarySearchPerformer,
  LibrarySearchStudio,
  LibrarySearchTag,
} from '../../../core/api/library.types';
import { PlayerService } from '../../../core/player/player.service';
import { libraryScenePlayerDetails } from '../../../core/player/player-details.util';
import { SceneCardComponent } from '../../../shared/scene-card/scene-card.component';

// Grouped search over the local library, shown on the Library page while its
// search box has text: matching scenes (a few at a time, with "Show more"),
// plus the matching performers, sites and tags. Picking one of those opens
// the library grid filtered to it.
import { RowReveal, tilesPerRow } from '../../../shared/show-more/reveal';

import { LogoContrastDirective } from '../../../shared/logo-contrast/logo-contrast.directive';
@Component({
  selector: 'app-library-search',
  imports: [LogoContrastDirective, RouterLink, Message, ProgressSpinner, SceneCardComponent],
  templateUrl: './library-search.component.html',
  styleUrl: './library-search.component.scss',
})
export class LibrarySearchComponent implements OnDestroy {
  static readonly SCENES_PER_PAGE = 5;
  private static readonly DEBOUNCE_MS = 250;

  private readonly libraryService = inject(LibraryService);
  private readonly playerService = inject(PlayerService);
  private readonly router = inject(Router);
  private readonly queries = new Subject<string>();
  private readonly retries = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private moreSubscription: Subscription | null = null;

  protected readonly activeQuery = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly scenes = signal<LibrarySceneItem[]>([]);
  protected readonly scenesTotal = signal(0);
  protected readonly scenesPage = signal(0);
  protected readonly scenesHasMore = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly loadMoreError = signal<string | null>(null);
  protected readonly performers = signal<LibrarySearchPerformer[]>([]);
  protected readonly studios = signal<LibrarySearchStudio[]>([]);
  protected readonly tags = signal<LibrarySearchTag[]>([]);
  // A row of performers and of sites (as many as fit) at first, then more on request.
  protected readonly performersShown = new RowReveal(1, 2);
  protected readonly studiosShown = new RowReveal(1, 2);
  // Performers and sites: as many as fit in a row (4, 6 or 8).
  protected readonly perRow = tilesPerRow();

  @Input({ required: true })
  set query(value: string) {
    this.queries.next(value.trim());
  }

  // Subscribed in the constructor, not ngOnInit: the query input is set
  // before ngOnInit runs, and a Subject would drop that first value.
  constructor() {
    // Retries bypass distinctUntilChanged, which would swallow the same query.
    this.searchSubscription = merge(
      this.queries.pipe(debounceTime(LibrarySearchComponent.DEBOUNCE_MS), distinctUntilChanged()),
      this.retries,
    )
      .pipe(
        tap((query) => {
          this.moreSubscription?.unsubscribe();
          this.activeQuery.set(query);
          this.loading.set(query.length > 0);
          this.error.set(null);
          this.loadingMore.set(false);
          this.loadMoreError.set(null);
        }),
        switchMap((query) =>
          query
            ? this.libraryService.search(query, LibrarySearchComponent.SCENES_PER_PAGE).pipe(
                catchError(() => {
                  this.error.set('Library search failed. Try again.');
                  return of(null);
                }),
              )
            : of(null),
        ),
      )
      .subscribe((result) => {
        this.loading.set(false);
        this.scenes.set(result?.scenes.items ?? []);
        this.scenesTotal.set(result?.scenes.total ?? 0);
        this.scenesPage.set(result?.scenes.page ?? 0);
        this.scenesHasMore.set(result?.scenes.hasMore ?? false);
        this.performersShown.reset();
        this.studiosShown.reset();
        this.performers.set(result?.performers ?? []);
        this.studios.set(result?.studios ?? []);
        this.tags.set(result?.tags ?? []);
      });
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.moreSubscription?.unsubscribe();
  }

  protected hasResults(): boolean {
    return (
      this.scenes().length > 0 ||
      this.performers().length > 0 ||
      this.studios().length > 0 ||
      this.tags().length > 0
    );
  }

  protected retry(): void {
    this.retries.next(this.activeQuery());
  }

  protected showMoreScenes(): void {
    if (this.loadingMore() || !this.scenesHasMore()) {
      return;
    }

    this.loadingMore.set(true);
    this.loadMoreError.set(null);
    this.moreSubscription = this.libraryService
      .searchScenes(
        this.activeQuery(),
        this.scenesPage() + 1,
        LibrarySearchComponent.SCENES_PER_PAGE,
      )
      .subscribe({
        next: (response) => {
          this.loadingMore.set(false);
          this.scenes.update((current) => [...current, ...response.items]);
          this.scenesTotal.set(response.total);
          this.scenesPage.set(response.page);
          this.scenesHasMore.set(response.hasMore);
        },
        error: () => {
          this.loadingMore.set(false);
          this.loadMoreError.set('Failed to load more scenes.');
        },
      });
  }

  protected remainingScenes(): number {
    return Math.max(0, this.scenesTotal() - this.scenes().length);
  }

  protected sceneCountLabel(count: number): string {
    return `${count.toLocaleString()} scene${count === 1 ? '' : 's'}`;
  }

  protected initial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected playScene(localSceneId: string): void {
    const item = this.scenes().find((scene) => scene.id === localSceneId);
    this.playerService.openByLocalSceneId({
      title: item?.title ?? 'Scene',
      localSceneId,
      imageUrl: item?.cardImageUrl ?? item?.imageUrl,
      details: item ? libraryScenePlayerDetails(item) : null,
    });
  }

}
