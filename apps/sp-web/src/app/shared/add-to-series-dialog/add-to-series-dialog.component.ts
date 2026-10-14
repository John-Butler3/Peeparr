import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  forkJoin,
  of,
  switchMap,
} from 'rxjs';
import { GroupsService } from '../../core/api/groups.service';
import { SceneSeriesMembership, SeriesSummary } from '../../core/api/groups.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';

// Adds a Stash scene to (or removes it from) series -- Stash Groups -- or
// creates a new series starting with it.
@Component({
  selector: 'app-add-to-series-dialog',
  imports: [FormsModule, RouterLink, Dialog, ProgressSpinner],
  templateUrl: './add-to-series-dialog.component.html',
  styleUrl: './add-to-series-dialog.component.scss',
})
export class AddToSeriesDialogComponent implements OnChanges, OnDestroy {
  private static readonly LIST_SIZE = 50;

  private readonly groupsService = inject(GroupsService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly searchTerms = new Subject<string>();
  private readonly searchSubscription: Subscription;
  private loadSubscription: Subscription | null = null;

  @Input() open = false;
  /** Stash-local scene id. */
  @Input() sceneId: string | null = null;
  @Input() sceneTitle: string | null = null;

  @Output() closed = new EventEmitter<void>();
  /** Emits the scene's series memberships after any change. */
  @Output() membershipsChanged = new EventEmitter<SceneSeriesMembership[]>();

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly series = signal<SeriesSummary[]>([]);
  protected readonly memberships = signal<SceneSeriesMembership[]>([]);
  protected readonly query = signal('');
  protected readonly busySeriesId = signal<string | null>(null);
  protected readonly newSeriesName = signal('');
  protected readonly creating = signal(false);

  constructor() {
    this.searchSubscription = this.searchTerms
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((query) =>
          this.groupsService
            .getSeries(1, AddToSeriesDialogComponent.LIST_SIZE, query || undefined)
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((response) => {
        if (response) {
          this.series.set(response.items);
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['open'] || changes['sceneId']) && this.open && this.sceneId) {
      this.load(this.sceneId);
    }
  }

  ngOnDestroy(): void {
    this.searchSubscription.unsubscribe();
    this.loadSubscription?.unsubscribe();
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.close();
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onQueryChanged(value: string): void {
    this.query.set(value);
    this.searchTerms.next(value.trim());
  }

  protected membershipFor(seriesId: string): SceneSeriesMembership | null {
    return this.memberships().find((membership) => membership.id === seriesId) ?? null;
  }

  protected toggle(series: SeriesSummary): void {
    const sceneId = this.sceneId;
    if (!sceneId || this.busySeriesId() || this.creating()) {
      return;
    }

    const isMember = !!this.membershipFor(series.id);
    this.busySeriesId.set(series.id);
    const request = isMember
      ? this.groupsService.removeScene(series.id, sceneId)
      : this.groupsService.addScene(series.id, sceneId);

    request.subscribe({
      next: (detail) => {
        this.busySeriesId.set(null);
        this.series.update((items) =>
          items.map((item) =>
            item.id === detail.id ? { ...item, sceneCount: detail.scenes.length } : item,
          ),
        );
        const part = detail.scenes.find((scene) => scene.id === sceneId);
        this.setMemberships(
          isMember
            ? this.memberships().filter((membership) => membership.id !== series.id)
            : [
                ...this.memberships(),
                { id: detail.id, name: detail.name, sceneIndex: part?.sceneIndex ?? null },
              ],
        );
      },
      error: () => {
        this.busySeriesId.set(null);
        this.notifications.error(isMember ? 'Failed to remove from series' : 'Failed to add to series');
      },
    });
  }

  protected createSeries(): void {
    const sceneId = this.sceneId;
    const name = this.newSeriesName().trim();
    if (!sceneId || !name || this.creating() || this.busySeriesId()) {
      return;
    }

    this.creating.set(true);
    this.groupsService.createSeries({ name, sceneId }).subscribe({
      next: (detail) => {
        this.creating.set(false);
        this.newSeriesName.set('');
        this.series.update((items) =>
          [
            ...items,
            {
              id: detail.id,
              name: detail.name,
              date: detail.date,
              studio: detail.studio,
              sceneCount: detail.scenes.length,
              coverImageUrl: detail.coverImageUrl,
            },
          ].sort((a, b) => a.name.localeCompare(b.name)),
        );
        this.setMemberships([
          ...this.memberships(),
          {
            id: detail.id,
            name: detail.name,
            sceneIndex: detail.scenes.find((scene) => scene.id === sceneId)?.sceneIndex ?? null,
          },
        ]);
        this.notifications.success(`Created "${detail.name}"`);
      },
      error: () => {
        this.creating.set(false);
        this.notifications.error('Failed to create series');
      },
    });
  }

  private setMemberships(memberships: SceneSeriesMembership[]): void {
    this.memberships.set(memberships);
    this.membershipsChanged.emit(memberships);
  }

  private load(sceneId: string): void {
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(null);
    this.query.set('');
    this.newSeriesName.set('');
    this.loadSubscription = forkJoin({
      series: this.groupsService.getSeries(1, AddToSeriesDialogComponent.LIST_SIZE),
      memberships: this.groupsService.getSeriesForScene(sceneId),
    }).subscribe({
      next: ({ series, memberships }) => {
        this.loading.set(false);
        this.series.set(series.items);
        this.memberships.set(memberships);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('Failed to load series from Stash.');
      },
    });
  }
}
