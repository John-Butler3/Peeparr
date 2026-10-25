import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Subscription, catchError, of } from 'rxjs';
import { LibraryService } from '../../core/api/library.service';
import { LibrarySceneItem } from '../../core/api/library.types';
import { libraryScenePlayerDetails } from '../../core/player/player-details.util';
import { PlayerService } from '../../core/player/player.service';
import { SceneCardComponent } from '../scene-card/scene-card.component';

/**
 * "Similar scenes": library scenes sharing a scene's tags (#anal,
 * #gangbang...), the ones sharing its rarer tags first. Below a scene;
 * shown when there are any.
 */
@Component({
  selector: 'app-similar-scenes',
  imports: [SceneCardComponent],
  styleUrl: './similar-scenes.component.scss',
  template: `
    @if (items().length > 0) {
      <section class="similar-section" data-testid="similar-by-tags">
        <div class="similar-head">
          <h2>Similar scenes</h2>
          <div class="similar-actions">
            <button
              type="button"
              class="scroll-button"
              (click)="scroll('prev')"
              aria-label="Scroll similar scenes left"
            >
              <i class="pi pi-angle-left" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="scroll-button"
              (click)="scroll('next')"
              aria-label="Scroll similar scenes right"
            >
              <i class="pi pi-angle-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="similar-viewport" #viewport>
          <div class="similar-track">
            @for (item of items(); track item.id) {
              <app-scene-card
                class="similar-card"
                [item]="item"
                variant="rail"
                [primaryLinkMode]="item.activeCatalogSceneId ? 'scene' : 'local'"
                [sceneRouteId]="item.activeCatalogSceneId"
                [sceneQueryParams]="returnTo ? { returnTo } : null"
                [playable]="true"
                previewKind="local"
                (play)="play($event)"
              />
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class SimilarScenesComponent implements OnChanges, OnDestroy {
  private readonly libraryService = inject(LibraryService);
  private readonly playerService = inject(PlayerService);
  private subscription: Subscription | null = null;
  private askedFor: string | null = null;

  /** The scene's tags (names). */
  @Input() tagNames: readonly string[] = [];
  /** Library scenes not to suggest: the scene itself (its copies). */
  @Input() excludeIds: readonly string[] = [];
  /** Catalog scenes shown already (e.g. More from this performer): not again. */
  @Input() alsoShown: readonly string[] = [];
  @Input() returnTo: string | null = null;

  @ViewChild('viewport') private viewport?: ElementRef<HTMLDivElement>;

  private readonly found = signal<LibrarySceneItem[]>([]);

  protected items(): LibrarySceneItem[] {
    const shown = new Set(this.alsoShown);
    return this.found().filter(
      (item) => !item.activeCatalogSceneId || !shown.has(item.activeCatalogSceneId),
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Lists made afresh on each check: only a real change asks again.
    const key = `${this.tagNames.join('\u0001')}#${this.excludeIds.join(',')}`;
    if ((!changes['tagNames'] && !changes['excludeIds']) || key === this.askedFor) {
      return;
    }
    this.askedFor = key;
    this.subscription?.unsubscribe();
    this.found.set([]);
    if (this.tagNames.length === 0) {
      return;
    }
    this.subscription = this.libraryService
      .getSimilarByTags(this.tagNames, this.excludeIds)
      .pipe(catchError(() => of({ items: [] as LibrarySceneItem[] })))
      .subscribe((response) => this.found.set(response.items));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  protected play(localSceneId: string): void {
    const item = this.found().find((candidate) => candidate.id === localSceneId);
    this.playerService.openByLocalSceneId({
      title: item?.title ?? 'Scene',
      localSceneId,
      imageUrl: item?.cardImageUrl ?? item?.imageUrl,
      details: item ? libraryScenePlayerDetails(item) : null,
    });
  }

  protected scroll(direction: 'prev' | 'next'): void {
    const viewport = this.viewport?.nativeElement;
    if (!viewport) {
      return;
    }
    const delta = Math.max(viewport.clientWidth * 0.82, 320);
    viewport.scrollBy({ left: direction === 'next' ? delta : -delta, behavior: 'smooth' });
  }
}
