import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import { DiscoverService } from '../../core/api/discover.service';
import { PlayerService } from '../../core/player/player.service';
import {
  PerformerFeedResponse,
  ScenesFeedResponse,
  StudioFeedResponse,
} from '../../core/api/discover.types';
import { SearchPageComponent } from './search-page.component';

function buildScenesResponse(overrides: Partial<ScenesFeedResponse> = {}): ScenesFeedResponse {
  return {
    total: 1,
    page: 1,
    perPage: 24,
    hasMore: false,
    items: [
      {
        id: 'scene-1',
        title: 'Scene One',
        description: null,
        imageUrl: 'http://cdn.local/scene-1.jpg',
        cardImageUrl: 'http://cdn.local/scene-1.jpg',
        studioId: 'studio-1',
        studio: 'Studio One',
        studioImageUrl: null,
        releaseDate: '2026-03-01',
        duration: 600,
        type: 'SCENE',
        source: 'STASHDB',
        status: { state: 'NOT_REQUESTED' },
        requestable: true,
      },
    ],
    ...overrides,
  };
}

function buildPerformersResponse(
  overrides: Partial<PerformerFeedResponse> = {},
): PerformerFeedResponse {
  return {
    total: 1,
    page: 1,
    perPage: 24,
    hasMore: false,
    items: [
      {
        id: 'performer-1',
        name: 'Performer One',
        gender: null,
        sceneCount: 4,
        isFavorite: false,
        imageUrl: null,
        cardImageUrl: null,
      },
    ],
    ...overrides,
  };
}

function buildStudiosResponse(overrides: Partial<StudioFeedResponse> = {}): StudioFeedResponse {
  return {
    total: 1,
    page: 1,
    perPage: 24,
    hasMore: false,
    items: [
      {
        id: 'studio-1',
        name: 'Studio One',
        isFavorite: false,
        imageUrl: null,
        parentStudio: null,
        childStudios: [],
      },
    ],
    ...overrides,
  };
}

describe('SearchPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderPage(
    initialQueryParams: Record<string, string> = {},
    options?: {
      scenesResponse?: ScenesFeedResponse;
      performersResponse?: PerformerFeedResponse;
      studiosResponse?: StudioFeedResponse;
    },
  ) {
    const queryParamMap = convertToParamMap(initialQueryParams);
    const queryParamMap$ = new BehaviorSubject(queryParamMap);
    const discoverService = {
      getScenesFeed: vi.fn().mockReturnValue(of(options?.scenesResponse ?? buildScenesResponse())),
      getPerformersFeed: vi
        .fn()
        .mockReturnValue(of(options?.performersResponse ?? buildPerformersResponse())),
      getStudiosFeed: vi.fn().mockReturnValue(of(options?.studiosResponse ?? buildStudiosResponse())),
      getSceneStreamUrl: vi.fn().mockReturnValue(
        of({
          streamUrl: 'http://stash.local/stream?apikey=secret',
          stashSceneId: 'stash-scene-1',
          resumeSeconds: 0,
          duration: 600,
        }),
      ),
    };
    const activatedRoute = {
      queryParamMap: queryParamMap$.asObservable(),
      snapshot: { queryParamMap },
    };
    const playerService = {
      openByCatalogSceneId: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SearchPageComponent],
      providers: [
        provideRouter([]),
        { provide: DiscoverService, useValue: discoverService },
        {
          provide: AppNotificationsService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        { provide: PlayerService, useValue: playerService },
        { provide: ActivatedRoute, useValue: activatedRoute },
        {
          provide: SceneQuickRequestService,
          useValue: { tryQuickRequest: vi.fn().mockReturnValue(of({ submitted: false })) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SearchPageComponent);
    return { fixture, discoverService, playerService };
  }

  it('shows a prompt state before any query is entered', async () => {
    const { fixture } = await renderPage();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Start typing to search scenes, performers, and studios.',
    );
  });

  it('runs the search immediately from an initial ?q= query param and renders results from all three sources', async () => {
    const { fixture, discoverService } = await renderPage({ q: 'one' });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    expect(discoverService.getScenesFeed).toHaveBeenCalledWith(
      1,
      24,
      'TITLE',
      'ASC',
      [],
      undefined,
      undefined,
      [],
      'one',
    );
    expect(discoverService.getPerformersFeed).toHaveBeenCalledWith(1, 24, {
      name: 'one',
      favoritesOnly: false,
    });
    expect(discoverService.getStudiosFeed).toHaveBeenCalledWith(1, 24, { name: 'one' });

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Scene One');
    expect(text).toContain('Performer One');
    expect(text).toContain('Studio One');
  });

  it('debounces typed input and re-runs the search', async () => {
    const { fixture, discoverService } = await renderPage();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.search-input') as HTMLInputElement;
    input.value = 'one';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    expect(discoverService.getScenesFeed).toHaveBeenCalled();
  });

  it('re-runs the search immediately (no debounce) when favorite performers only is toggled', async () => {
    const { fixture, discoverService } = await renderPage({ q: 'one' });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();
    discoverService.getPerformersFeed.mockClear();

    const component = fixture.componentInstance as unknown as {
      onFavoritePerformersOnlyChanged(value: boolean): void;
    };
    component.onFavoritePerformersOnlyChanged(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(discoverService.getPerformersFeed).toHaveBeenCalledWith(1, 24, {
      name: 'one',
      favoritesOnly: true,
    });
  });

  it('shows a no-matches state when nothing comes back for a query', async () => {
    const { fixture } = await renderPage(
      { q: 'nothing' },
      {
        scenesResponse: { total: 0, page: 1, perPage: 24, hasMore: false, items: [] },
        performersResponse: { total: 0, page: 1, perPage: 24, hasMore: false, items: [] },
        studiosResponse: { total: 0, page: 1, perPage: 24, hasMore: false, items: [] },
      },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No matches for "nothing".');
  });
});
