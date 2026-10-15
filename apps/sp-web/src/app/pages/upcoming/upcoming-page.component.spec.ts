import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { UpcomingItem, UpcomingResponse, UpcomingService } from '../../core/api/upcoming.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import { UpcomingPageComponent } from './upcoming-page.component';

const item = (id: string, releaseDate: string, reasons: UpcomingItem['reasons']): UpcomingItem => ({
  id,
  title: `Scene ${id}`,
  description: null,
  imageUrl: null,
  cardImageUrl: null,
  studioId: 'st1',
  studio: 'Anchor Studios',
  studioImageUrl: null,
  releaseDate,
  duration: null,
  type: 'SCENE',
  source: 'STASHDB',
  status: { state: reasons.some((r) => r.kind === 'REQUESTED') ? 'REQUESTED' : 'NOT_REQUESTED' },
  requestable: !reasons.some((r) => r.kind === 'REQUESTED'),
  reasons,
});

describe('UpcomingPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(response: Partial<UpcomingResponse>) {
    const quickRequest = { tryQuickRequest: vi.fn().mockReturnValue(of({ submitted: true })) };
    await TestBed.configureTestingModule({
      imports: [UpcomingPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: UpcomingService,
          useValue: {
            getUpcoming: () =>
              of({ from: '2026-10-09', to: '2027-04-14', today: '2026-10-16', items: [], ...response }),
          },
        },
        { provide: SceneQuickRequestService, useValue: quickRequest },
        { provide: AppNotificationsService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(UpcomingPageComponent);
    fixture.detectChanges();
    return { fixture, quickRequest, element: fixture.nativeElement as HTMLElement };
  }

  const items = [
    item('a', '2026-10-16', [{ kind: 'REQUESTED', id: null, name: null }]),
    item('b', '2026-10-17', [{ kind: 'PERFORMER', id: 'p1', name: 'Anna Example' }]),
    item('c', '2026-10-17', [{ kind: 'STUDIO', id: 'st1', name: 'Anchor Studios' }]),
  ];

  it('lists releases a day at a time, with why each is there', async () => {
    const { element } = await render({ items });

    const heads = Array.from(element.querySelectorAll('.day-head')).map((h) => h.textContent?.trim());
    expect(heads[0]).toMatch(/^Today · /);
    expect(heads[1]).toMatch(/^Tomorrow · /);
    expect(element.querySelectorAll('[data-date="2026-10-17"] app-scene-card')).toHaveLength(2);
    expect(element.textContent).toContain('★ Anna Example');
    expect(element.textContent).toContain('Requested');
  });

  it('shows a sliding calendar from last week, marking today and days with releases', async () => {
    const { element } = await render({ items });

    const days = Array.from(element.querySelectorAll<HTMLElement>('.strip .day'));
    expect(days[0].dataset['day']).toBe('2026-10-09');
    // At least four weeks ahead even when releases stop sooner.
    expect(days.at(-1)?.dataset['day']).toBe('2026-11-12');
    const today = element.querySelector<HTMLElement>('[data-day="2026-10-16"]')!;
    expect(today.classList).toContain('today');
    expect(element.querySelectorAll('[data-day="2026-10-17"] .dots i')).toHaveLength(2);
    expect(element.querySelector('[data-day="2026-10-10"]')?.classList).toContain('past');
  });

  it('filters to one kind of reason', async () => {
    const { fixture, element } = await render({ items });

    const performers = Array.from(element.querySelectorAll<HTMLButtonElement>('.filter')).find((b) =>
      b.textContent?.includes('Performers'),
    )!;
    expect(performers.textContent).toContain('1');
    performers.click();
    fixture.detectChanges();

    expect(element.querySelectorAll('app-scene-card')).toHaveLength(1);
    expect(element.textContent).toContain('★ Anna Example');
  });

  it('requests an upcoming scene and marks it requested', async () => {
    const { fixture, element, quickRequest } = await render({ items });

    fixture.componentInstance['openRequestModal']({ id: 'b', title: 'Scene b', imageUrl: null });
    fixture.detectChanges();

    expect(quickRequest.tryQuickRequest).toHaveBeenCalledWith('b');
    const requestedFilter = Array.from(element.querySelectorAll<HTMLButtonElement>('.filter')).find((b) =>
      b.textContent?.includes('Requested'),
    )!;
    expect(requestedFilter.textContent).toContain('2');
  });

  it('explains how to fill it when nothing is coming up', async () => {
    const { element } = await render({ items: [] });

    expect(element.querySelector('[data-testid="upcoming-empty"]')?.textContent).toContain(
      'Nothing coming up yet',
    );
    expect(element.querySelector('[data-testid="upcoming-calendar"]')).toBeNull();
  });
});
