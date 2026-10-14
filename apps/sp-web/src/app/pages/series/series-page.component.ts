import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { GroupsService } from '../../core/api/groups.service';
import { SeriesSummary } from '../../core/api/groups.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';

// Series = Stash Groups: ordered collections of scenes (multi-part scenes,
// a running storyline, ...). Listed here; each opens SeriesDetailPage.
@Component({
  selector: 'app-series-page',
  imports: [FormsModule, RouterLink, Message, ProgressSpinner],
  templateUrl: './series-page.component.html',
  styleUrl: './series-page.component.scss',
})
export class SeriesPageComponent implements OnInit, OnDestroy {
  private static readonly PAGE_SIZE = 24;

  private readonly groupsService = inject(GroupsService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly router = inject(Router);
  private readonly searchTerms = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private loadSubscription: Subscription | null = null;

  protected readonly query = signal('');
  protected readonly items = signal<SeriesSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly hasMore = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly newSeriesName = signal('');
  protected readonly createInFlight = signal(false);

  ngOnInit(): void {
    this.searchSubscription = this.searchTerms
      .pipe(debounceTime(250), distinctUntilChanged())
      .subscribe(() => this.load(1));
    this.load(1);
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.loadSubscription?.unsubscribe();
  }

  protected onQueryChanged(value: string): void {
    this.query.set(value);
    this.searchTerms.next(value.trim());
  }

  protected loadMore(): void {
    if (!this.loadingMore() && this.hasMore()) {
      this.load(this.page() + 1);
    }
  }

  protected retry(): void {
    this.load(1);
  }

  protected startCreate(): void {
    this.creating.set(true);
  }

  protected cancelCreate(): void {
    this.creating.set(false);
    this.newSeriesName.set('');
  }

  protected createSeries(): void {
    const name = this.newSeriesName().trim();
    if (!name || this.createInFlight()) {
      return;
    }

    this.createInFlight.set(true);
    this.groupsService.createSeries({ name }).subscribe({
      next: (series) => {
        this.createInFlight.set(false);
        void this.router.navigate(['/series', series.id]);
      },
      error: () => {
        this.createInFlight.set(false);
        this.notifications.error('Failed to create series');
      },
    });
  }

  protected partsLabel(count: number): string {
    return `${count} part${count === 1 ? '' : 's'}`;
  }

  private load(page: number): void {
    const isFirstPage = page === 1;
    this.loadSubscription?.unsubscribe();
    this.error.set(null);
    (isFirstPage ? this.loading : this.loadingMore).set(true);

    this.loadSubscription = this.groupsService
      .getSeries(page, SeriesPageComponent.PAGE_SIZE, this.query().trim() || undefined)
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          this.loadingMore.set(false);
          this.items.update((current) =>
            isFirstPage ? response.items : [...current, ...response.items],
          );
          this.total.set(response.total);
          this.page.set(response.page);
          this.hasMore.set(response.hasMore);
        },
        error: () => {
          this.loading.set(false);
          this.loadingMore.set(false);
          if (isFirstPage) {
            this.error.set('Failed to load series from Stash.');
          } else {
            this.notifications.error('Failed to load more series');
          }
        },
      });
  }
}
