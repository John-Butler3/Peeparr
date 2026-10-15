import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SceneRequestContext } from '../../core/api/discover.types';
import { UpcomingItem, UpcomingReason, UpcomingService } from '../../core/api/upcoming.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import { SceneCardBadge, SceneCardComponent } from '../../shared/scene-card/scene-card.component';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';

export type UpcomingFilter = 'ALL' | 'REQUESTED' | 'PERFORMER' | 'STUDIO';

interface CalendarDay {
  date: string;
  weekday: string;
  day: number;
  /** Shown above the first day of each month (and the first day). */
  month: string | null;
  count: number;
  isToday: boolean;
  isPast: boolean;
}

interface DayGroup {
  date: string;
  label: string;
  items: UpcomingItem[];
}

/**
 * What's coming up: requested scenes that aren't out yet, and new releases
 * from favourite performers and sites, on a sliding calendar. The strip of
 * days scrolls sideways; tapping a day jumps the list to it, and scrolling
 * the list keeps the strip on the day in view.
 */
@Component({
  selector: 'app-upcoming-page',
  imports: [RouterLink, SceneCardComponent, SceneRequestModalComponent],
  templateUrl: './upcoming-page.component.html',
  styleUrl: './upcoming-page.component.scss',
})
export class UpcomingPageComponent {
  /** Days shown past the last release, so the strip never ends abruptly. */
  static readonly MIN_DAYS_AHEAD = 27;

  private readonly upcomingService = inject(UpcomingService);
  private readonly sceneQuickRequestService = inject(SceneQuickRequestService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  @ViewChild('strip') private stripRef?: ElementRef<HTMLElement>;

  protected readonly filterOptions: ReadonlyArray<{ value: UpcomingFilter; label: string }> = [
    { value: 'ALL', label: 'All' },
    { value: 'REQUESTED', label: 'Requested' },
    { value: 'PERFORMER', label: 'Performers' },
    { value: 'STUDIO', label: 'Sites' },
  ];
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly items = signal<UpcomingItem[]>([]);
  protected readonly from = signal<string | null>(null);
  protected readonly today = signal<string | null>(null);
  protected readonly filter = signal<UpcomingFilter>('ALL');
  /** The day in view (or last tapped). */
  protected readonly activeDate = signal<string | null>(null);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);

  protected readonly counts = computed(() => {
    const items = this.items();
    const has = (kind: UpcomingReason['kind']) =>
      items.filter((item) => item.reasons.some((reason) => reason.kind === kind)).length;
    return {
      ALL: items.length,
      REQUESTED: has('REQUESTED'),
      PERFORMER: has('PERFORMER'),
      STUDIO: has('STUDIO'),
    } satisfies Record<UpcomingFilter, number>;
  });

  protected readonly filtered = computed(() => {
    const filter = this.filter();
    return filter === 'ALL'
      ? this.items()
      : this.items().filter((item) => item.reasons.some((reason) => reason.kind === filter));
  });

  protected readonly groups = computed<DayGroup[]>(() => {
    const groups = new Map<string, UpcomingItem[]>();
    for (const item of this.filtered()) {
      const list = groups.get(item.releaseDate) ?? [];
      list.push(item);
      groups.set(item.releaseDate, list);
    }
    return [...groups.entries()].map(([date, items]) => ({ date, label: this.dayLabel(date), items }));
  });

  protected readonly days = computed<CalendarDay[]>(() => {
    const from = this.from();
    const today = this.today();
    if (!from || !today) {
      return [];
    }

    const counts = new Map<string, number>();
    for (const item of this.filtered()) {
      counts.set(item.releaseDate, (counts.get(item.releaseDate) ?? 0) + 1);
    }
    const lastRelease = this.filtered().at(-1)?.releaseDate ?? today;
    const minEnd = this.shift(today, UpcomingPageComponent.MIN_DAYS_AHEAD);
    const end = lastRelease > minEnd ? lastRelease : minEnd;

    const days: CalendarDay[] = [];
    for (let date = from; date <= end; date = this.shift(date, 1)) {
      const d = this.parse(date);
      days.push({
        date,
        weekday: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
        day: d.getUTCDate(),
        month:
          days.length === 0 || d.getUTCDate() === 1
            ? d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
            : null,
        count: counts.get(date) ?? 0,
        isToday: date === today,
        isPast: date < today,
      });
    }
    return days;
  });

  protected readonly activeMonth = computed(() => {
    const date = this.activeDate() ?? this.today();
    return date
      ? this.parse(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : '';
  });

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.scrollFrame));
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.upcomingService.getUpcoming().subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.from.set(response.from);
        this.today.set(response.today);
        this.loading.set(false);
        // Open on today, with the last week just above.
        requestAnimationFrame(() => this.jumpTo(response.today, 'auto'));
      },
      error: () => {
        this.loading.set(false);
        this.error.set("Couldn't load what's coming up. Please try again.");
      },
    });
  }

  protected setFilter(filter: UpcomingFilter): void {
    this.filter.set(filter);
    const target = this.activeDate() ?? this.today();
    requestAnimationFrame(() => target && this.jumpTo(target, 'auto'));
  }

  /** Scroll the list to this day, or the next day with releases. */
  protected jumpTo(date: string, behavior: ScrollBehavior = 'smooth'): void {
    const groups = this.groups();
    const group = groups.find((g) => g.date >= date) ?? groups.at(-1);
    this.activeDate.set(group?.date ?? date);
    this.centreDay(this.activeDate()!, behavior);
    if (!group) {
      return;
    }
    const element = this.host.querySelector<HTMLElement>(`[data-date="${group.date}"]`);
    element?.scrollIntoView?.({ behavior, block: 'start' });
  }

  /** Slide the strip by most of its width. */
  protected slide(direction: 1 | -1): void {
    const strip = this.stripRef?.nativeElement;
    strip?.scrollBy?.({ left: direction * strip.clientWidth * 0.8, behavior: 'smooth' });
  }

  protected badges(item: UpcomingItem): SceneCardBadge[] {
    return item.reasons.slice(0, 2).map((reason) => ({
      label: reason.kind === 'REQUESTED' ? 'Requested' : `★ ${reason.name ?? (reason.kind === 'STUDIO' ? 'Site' : 'Performer')}`,
    }));
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

  protected onRequestSubmitted(sceneId: string): void {
    this.requestModalOpen.set(false);
    this.items.update((items) =>
      items.map((item) =>
        item.id === sceneId
          ? {
              ...item,
              status: { ...item.status, state: 'REQUESTED' },
              requestable: false,
              reasons: item.reasons.some((reason) => reason.kind === 'REQUESTED')
                ? item.reasons
                : [{ kind: 'REQUESTED', id: null, name: null }, ...item.reasons],
            }
          : item,
      ),
    );
  }

  // Keep the strip on the day at the top of the list while scrolling.
  private scrollFrame = 0;
  @HostListener('window:scroll')
  protected onScroll(): void {
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => {
      const sections = Array.from(this.host.querySelectorAll<HTMLElement>('[data-date]'));
      // A day counts as in view once its heading reaches just under the
      // calendar (where jumping to it puts it; see scroll-margin-top).
      const calendar = this.host.querySelector<HTMLElement>('.calendar');
      const line = (calendar?.getBoundingClientRect().bottom ?? 0) + 40;
      let current: string | null = null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) {
          current = section.dataset['date'] ?? current;
        }
      }
      if (current && current !== this.activeDate()) {
        this.activeDate.set(current);
        this.centreDay(current, 'smooth');
      }
    });
  }

  private centreDay(date: string, behavior: ScrollBehavior): void {
    const strip = this.stripRef?.nativeElement;
    const day = strip?.querySelector<HTMLElement>(`[data-day="${date}"]`);
    if (!strip || !day) {
      return;
    }
    strip.scrollTo?.({ left: day.offsetLeft - strip.clientWidth / 2 + day.offsetWidth / 2, behavior });
  }

  private dayLabel(date: string): string {
    const today = this.today();
    const full = this.parse(date).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
    if (today && date === today) {
      return `Today · ${full}`;
    }
    if (today && date === this.shift(today, 1)) {
      return `Tomorrow · ${full}`;
    }
    if (today && date === this.shift(today, -1)) {
      return `Yesterday · ${full}`;
    }
    return full;
  }

  private parse(date: string): Date {
    return new Date(`${date}T00:00:00Z`);
  }

  private shift(date: string, days: number): string {
    return new Date(this.parse(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  }
}
