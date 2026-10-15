import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, forkJoin, map, of, switchMap } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { PerformerFeedItem, SceneExplorerItem, StudioFeedItem } from '../../core/api/discover.types';

interface SuggestResults {
  performers: PerformerFeedItem[];
  studios: StudioFeedItem[];
  scenes: SceneExplorerItem[];
}

/** One row in the dropdown, in keyboard order. */
interface SuggestRow {
  kind: 'performer' | 'studio' | 'scene' | 'all';
  commands: unknown[];
  queryParams?: Record<string, string>;
}

const EMPTY: SuggestResults = { performers: [], studios: [], scenes: [] };

/**
 * Live search results under a search box, as you type: a few performers,
 * sites and scenes, and "See all results". Give it the box (`input`) and
 * what's typed (`query`); it handles the arrow keys, Enter and Escape on
 * the box, and closes on a tap outside or when a result is opened.
 */
@Component({
  selector: 'app-search-suggest',
  imports: [RouterLink],
  templateUrl: './search-suggest.component.html',
  styleUrl: './search-suggest.component.scss',
})
export class SearchSuggestComponent {
  static readonly MIN_CHARS = 2;
  static readonly DEBOUNCE_MS = 250;
  static readonly PERFORMERS = 4;
  static readonly STUDIOS = 3;
  static readonly SCENES = 5;

  private readonly discoverService = inject(DiscoverService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly terms = new Subject<string>();
  private inputElement: HTMLInputElement | null = null;

  protected readonly term = signal('');
  protected readonly results = signal<SuggestResults>(EMPTY);
  protected readonly loading = signal(false);
  /** Shown while focused/typing; closed by Escape, outside taps and opening a result. */
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);

  /** Emitted when a result (or "See all") is opened, so the host can clear up. */
  @Output() readonly navigated = new EventEmitter<void>();

  /** The search box this belongs to. */
  @Input({ required: true }) set input(element: HTMLInputElement) {
    this.inputElement?.removeEventListener('keydown', this.onKeydown, true);
    this.inputElement?.removeEventListener('focus', this.onFocus);
    this.inputElement = element;
    // Capture phase: runs before the box's own key handlers (e.g. Enter to
    // search), so choosing a result can stop them.
    element.addEventListener('keydown', this.onKeydown, true);
    element.addEventListener('focus', this.onFocus);
    element.setAttribute('aria-autocomplete', 'list');
  }

  @Input() set query(value: string | null) {
    const term = (value ?? '').trim();
    this.term.set(term);
    this.activeIndex.set(-1);
    this.open.set(term.length >= SearchSuggestComponent.MIN_CHARS);
    this.terms.next(term);
  }

  protected readonly visible = computed(
    () => this.open() && this.term().length >= SearchSuggestComponent.MIN_CHARS,
  );

  protected readonly hasResults = computed(() => {
    const r = this.results();
    return r.performers.length + r.studios.length + r.scenes.length > 0;
  });

  /** Every row in keyboard order: "See all" first, then the results. */
  protected readonly rows = computed<SuggestRow[]>(() => {
    const r = this.results();
    return [
      { kind: 'all' as const, commands: ['/search'], queryParams: { q: this.term() } },
      ...r.performers.map((p) => ({ kind: 'performer' as const, commands: ['/performer', p.id] })),
      ...r.studios.map((s) => ({ kind: 'studio' as const, commands: ['/studio', s.id] })),
      ...r.scenes.map((s) => ({ kind: 'scene' as const, commands: ['/scene', s.id] })),
    ];
  });

  // Row numbers for the template (for highlighting the active row).
  protected readonly performerOffset = 1;
  protected readonly studioOffset = computed(() => 1 + this.results().performers.length);
  protected readonly sceneOffset = computed(
    () => 1 + this.results().performers.length + this.results().studios.length,
  );

  constructor() {
    const subscription = this.terms
      .pipe(
        debounceTime(SearchSuggestComponent.DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((term) => {
          if (term.length < SearchSuggestComponent.MIN_CHARS) {
            this.loading.set(false);
            return of(EMPTY);
          }
          this.loading.set(true);
          return forkJoin({
            performers: this.discoverService
              .getPerformersFeed(1, SearchSuggestComponent.PERFORMERS, { name: term })
              .pipe(map((r) => r.items), catchError(() => of([]))),
            studios: this.discoverService
              .getStudiosFeed(1, SearchSuggestComponent.STUDIOS, { name: term })
              .pipe(map((r) => r.items), catchError(() => of([]))),
            scenes: this.discoverService
              .getScenesFeed(1, SearchSuggestComponent.SCENES, 'TITLE', 'ASC', [], undefined, undefined, [], term)
              .pipe(map((r) => r.items), catchError(() => of([]))),
          });
        }),
      )
      .subscribe((results) => {
        this.loading.set(false);
        this.results.set({
          performers: results.performers.slice(0, SearchSuggestComponent.PERFORMERS),
          studios: results.studios.slice(0, SearchSuggestComponent.STUDIOS),
          scenes: results.scenes.slice(0, SearchSuggestComponent.SCENES),
        });
        this.activeIndex.set(-1);
      });

    // Any page change (a result, "See all", or the box's own search) closes it.
    const navigation = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.open.set(false);
      }
    });
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !this.host.contains(target) && target !== this.inputElement) {
        this.open.set(false);
      }
    };
    document.addEventListener('pointerdown', onOutside, true);
    inject(DestroyRef).onDestroy(() => {
      subscription.unsubscribe();
      navigation.unsubscribe();
      document.removeEventListener('pointerdown', onOutside, true);
      this.inputElement?.removeEventListener('keydown', this.onKeydown, true);
      this.inputElement?.removeEventListener('focus', this.onFocus);
    });
  }

  protected opened(): void {
    this.open.set(false);
    this.navigated.emit();
  }

  protected imageOf(performer: PerformerFeedItem): string | null {
    return performer.cardImageUrl ?? performer.imageUrl;
  }

  protected statusLabel(scene: SceneExplorerItem): string | null {
    switch (scene.status.state) {
      case 'AVAILABLE':
        return 'In library';
      case 'NOT_REQUESTED':
        return null;
      case 'FAILED':
        return 'Failed';
      default:
        return 'Requested';
    }
  }

  private readonly onFocus = (): void => {
    if (this.term().length >= SearchSuggestComponent.MIN_CHARS) {
      this.open.set(true);
    }
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.visible()) {
        event.preventDefault();
        this.open.set(false);
      }
      return;
    }
    if (!this.visible()) {
      return;
    }
    const count = this.rows().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      // Rows 0..count-1, wrapping through -1 ("nothing selected", where
      // Enter just runs the search).
      this.activeIndex.update((i) =>
        event.key === 'ArrowDown' ? (i + 1 >= count ? -1 : i + 1) : i - 1 < -1 ? count - 1 : i - 1,
      );
      this.host
        .querySelector<HTMLElement>(`[data-row="${this.activeIndex()}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter' && this.activeIndex() >= 0) {
      const row = this.rows()[this.activeIndex()];
      if (row) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.router.navigate(row.commands, { queryParams: row.queryParams });
        this.opened();
      }
    }
  };
}
