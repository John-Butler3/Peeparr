import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Subscription } from 'rxjs';
import { LibraryService } from '../../core/api/library.service';
import { LibrarySceneItem } from '../../core/api/library.types';
import { LibraryDeletionService } from '../../core/library/library-deletion.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';

type Decision = 'keep' | 'delete';

/**
 * Settings > Purge: the library one scene at a time, oldest in it first,
 * each a card with its thumbnail and title. Swipe right (or Keep) to keep
 * it; swipe left (or Delete) and it's deleted at once -- the file from
 * Stash, and out of Whisparr -- with no undo. Kept scenes are remembered on
 * this device, so a later visit carries on with the ones not yet seen;
 * "Start over" forgets them.
 *
 * The deck is a prefix of the library in order of adding (new scenes join
 * at the end), so what's left to go through always starts right after the
 * kept ones: that's the page to load.
 */
@Component({
  selector: 'app-purge-settings-page',
  imports: [ButtonDirective, Message, ProgressSpinner],
  templateUrl: './purge-settings-page.component.html',
  styleUrl: './purge-settings-page.component.scss',
})
export class PurgeSettingsPageComponent implements OnInit, OnDestroy {
  static readonly PER_PAGE = 24;
  /** Load more when this few are left in the deck. */
  static readonly LOW_WATER = 6;
  /** How far a swipe must go to count. */
  static readonly SWIPE_PX = 110;
  /** A decided card flying off, before the next one is on top. */
  static readonly FLY_MS = 280;
  private static readonly KEPT_KEY = 'peeparr.purge.kept';

  private readonly library = inject(LibraryService);
  private readonly deletion = inject(LibraryDeletionService);
  private readonly notifications = inject(AppNotificationsService);

  protected readonly started = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** Scenes loaded and not yet decided on, the first on top. */
  protected readonly deck = signal<LibrarySceneItem[]>([]);
  /** Scenes in the library, as of the last page loaded. */
  protected readonly total = signal<number | null>(null);
  protected readonly keptNow = signal(0);
  protected readonly deletedNow = signal(0);
  protected readonly dragX = signal(0);
  protected readonly dragging = signal(false);
  /** The top card on its way off. */
  protected readonly flying = signal<Decision | null>(null);
  /** Kept on this device, across visits. */
  protected readonly keptBefore = signal(0);

  protected readonly current = computed(() => this.deck()[0] ?? null);
  protected readonly next = computed(() => this.deck()[1] ?? null);
  protected readonly leaning = computed<Decision | null>(() => {
    const x = this.dragX();
    return x > 30 ? 'keep' : x < -30 ? 'delete' : null;
  });
  /** How far towards a decision the drag is, 0..1. */
  protected readonly leanAmount = computed(() =>
    Math.min(1, Math.abs(this.dragX()) / PurgeSettingsPageComponent.SWIPE_PX),
  );
  /** Still to go through (the library less the kept), never fewer than what's loaded. */
  protected readonly remaining = computed(() => {
    const total = this.total();
    return total === null ? null : Math.max(this.deck().length, total - this.kept.size);
  });
  protected readonly finished = computed(
    () => this.started() && !this.loading() && !this.hasMore && this.deck().length === 0,
  );

  private kept = new Set<string>();
  private hasMore = true;
  private fetching = false;
  private fetch: Subscription | null = null;
  /** Pages found to hold nothing new, past the computed one. */
  private pagesSkipped = 0;
  private drag: { x: number; y: number; sideways: boolean | null } | null = null;
  private flyTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.kept = this.loadKept();
    this.keptBefore.set(this.kept.size);
  }

  ngOnDestroy(): void {
    this.fetch?.unsubscribe();
    if (this.flyTimer) {
      clearTimeout(this.flyTimer);
    }
  }

  protected start(): void {
    this.started.set(true);
    this.loadMore();
  }

  /** Forgets the kept scenes: everything comes round again. */
  protected startOver(): void {
    this.kept.clear();
    this.saveKept();
    this.keptBefore.set(0);
    this.keptNow.set(0);
    this.deletedNow.set(0);
    this.deck.set([]);
    this.hasMore = true;
    this.pagesSkipped = 0;
    this.fetch?.unsubscribe();
    this.fetching = false;
    this.started.set(true);
    this.loadMore();
  }

  protected retry(): void {
    this.loadError.set(null);
    this.loadMore();
  }

  protected keep(): void {
    this.decide('keep');
  }

  protected delete(): void {
    this.decide('delete');
  }

  // Dragging the top card: sideways swipes decide, up and down still scroll
  // (touch-action: pan-y on the card).
  protected onPointerDown(event: PointerEvent): void {
    if (this.flying() || !this.current() || event.button !== 0) {
      return;
    }
    this.drag = { x: event.clientX, y: event.clientY, sideways: null };
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.sideways === null && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      drag.sideways = Math.abs(dx) > Math.abs(dy);
      if (drag.sideways) {
        (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
      }
    }
    if (drag.sideways) {
      this.dragging.set(true);
      this.dragX.set(dx);
    }
  }

  protected onPointerUp(): void {
    const dx = this.dragX();
    const wasDragging = this.dragging();
    this.drag = null;
    this.dragging.set(false);
    if (wasDragging && Math.abs(dx) >= PurgeSettingsPageComponent.SWIPE_PX) {
      this.decide(dx < 0 ? 'delete' : 'keep');
    } else {
      this.dragX.set(0);
    }
  }

  protected onPointerCancel(): void {
    this.drag = null;
    this.dragging.set(false);
    this.dragX.set(0);
  }

  /** The top card's position: following the finger, or flying off. */
  protected cardTransform(): string {
    const flying = this.flying();
    if (flying) {
      const sign = flying === 'delete' ? -1 : 1;
      return `translateX(${sign * 130}%) rotate(${sign * 18}deg)`;
    }
    const x = this.dragX();
    return x ? `translateX(${x}px) rotate(${x / 14}deg)` : '';
  }

  protected thumbnail(scene: LibrarySceneItem): string | null {
    return scene.cardImageUrl ?? scene.imageUrl;
  }

  protected byline(scene: LibrarySceneItem): string {
    return [scene.studio, scene.releaseDate, this.duration(scene.duration)]
      .filter((part): part is string => !!part)
      .join(' · ');
  }

  private duration(seconds: number | null): string | null {
    if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    const whole = Math.round(seconds);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  private decide(decision: Decision): void {
    const scene = this.current();
    if (!scene || this.flying()) {
      return;
    }
    this.flying.set(decision);
    if (decision === 'keep') {
      this.kept.add(scene.id);
      this.saveKept();
      this.keptNow.update((n) => n + 1);
    } else {
      this.deleteScene(scene);
    }
    this.flyTimer = setTimeout(() => {
      this.flyTimer = null;
      this.deck.update((deck) => deck.filter((item) => item.id !== scene.id));
      this.flying.set(null);
      this.dragX.set(0);
      this.loadMoreIfLow();
    }, PurgeSettingsPageComponent.FLY_MS);
  }

  // Deleted at once; the deck moves on meanwhile. Should Stash refuse, the
  // scene comes back on top with the reason.
  private deleteScene(scene: LibrarySceneItem): void {
    this.deletion
      .deleteNow({ stashSceneIds: [scene.id], catalogSceneId: scene.activeCatalogSceneId })
      .subscribe({
        next: () => {
          this.deletedNow.update((n) => n + 1);
          this.total.update((total) => (total === null ? null : Math.max(0, total - 1)));
        },
        error: (error: { error?: { message?: string } }) => {
          this.notifications.error(
            `Couldn't delete "${scene.title}"`,
            error.error?.message ?? 'Please try again.',
          );
          this.deck.update((deck) =>
            deck.some((item) => item.id === scene.id) ? deck : [scene, ...deck],
          );
        },
      });
  }

  private loadMoreIfLow(): void {
    if (this.deck().length <= PurgeSettingsPageComponent.LOW_WATER) {
      this.loadMore();
    }
  }

  /**
   * The next page of scenes not yet decided on. Everything before the deck in
   * the library's order has been kept (deleted ones are gone from it), so the
   * deck's end sits at position kept + loaded; the page holding that position
   * is the one to load, less whatever of it is already kept or loaded.
   */
  private loadMore(): void {
    if (this.fetching || !this.hasMore) {
      return;
    }
    const perPage = PurgeSettingsPageComponent.PER_PAGE;
    const position = this.kept.size + this.deck().length;
    const page = Math.floor(position / perPage) + 1 + this.pagesSkipped;
    this.loading.set(this.deck().length === 0);
    this.fetching = true;
    this.fetch = this.library
      .getScenesFeed(page, perPage, { sort: 'CREATED_AT', direction: 'ASC' })
      .subscribe({
        next: (feed) => {
          this.fetching = false;
          this.loading.set(false);
          this.total.set(feed.total);
          this.hasMore = feed.hasMore;
          const loaded = new Set(this.deck().map((item) => item.id));
          const fresh = feed.items.filter(
            (item) => !this.kept.has(item.id) && !loaded.has(item.id),
          );
          if (fresh.length > 0) {
            this.pagesSkipped = 0;
            this.deck.update((deck) => [...deck, ...fresh]);
          } else if (feed.hasMore) {
            // Kept scenes gone from Stash since put the sums out: the next page.
            this.pagesSkipped += 1;
            this.loadMore();
          }
        },
        error: (error: { error?: { message?: string } }) => {
          this.fetching = false;
          this.loading.set(false);
          this.loadError.set(error.error?.message ?? "Couldn't load your library.");
        },
      });
  }

  private loadKept(): Set<string> {
    try {
      const raw = localStorage.getItem(PurgeSettingsPageComponent.KEPT_KEY);
      const ids: unknown = raw ? JSON.parse(raw) : [];
      return new Set(
        Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      );
    } catch {
      return new Set();
    }
  }

  private saveKept(): void {
    try {
      localStorage.setItem(PurgeSettingsPageComponent.KEPT_KEY, JSON.stringify([...this.kept]));
    } catch {
      // Private browsing or full: kept for this visit only.
    }
  }
}
