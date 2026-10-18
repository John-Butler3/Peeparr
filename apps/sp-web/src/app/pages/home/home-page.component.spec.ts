import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneExplorerItem, ScenesFeedResponse } from '../../core/api/discover.types';
import { HomeService } from '../../core/api/home.service';
import { HomeRailContentResponse, HomeRailItem } from '../../core/api/home.types';
import { PlayerService } from '../../core/player/player.service';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { RuntimeHealthResponse } from '../../core/api/runtime-health.types';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { HomePageComponent } from './home-page.component';

function buildRailItem(overrides: Partial<HomeRailItem> = {}): HomeRailItem {
  return {
    id: 'local-scene-1',
    activeCatalogSceneId: null,
    title: 'Library Scene',
    description: 'Already in the local library.',
    imageUrl: '/api/media/stash/scenes/local-scene-1/screenshot',
    cardImageUrl: '/api/media/stash/scenes/local-scene-1/screenshot',
    studioId: 'studio-2',
    studio: 'Archive',
    studioImageUrl: '/api/media/stash/studios/studio-2/logo',
    releaseDate: '2026-03-27',
    duration: 1500,
    type: 'SCENE',
    source: 'STASH',
    status: { state: 'AVAILABLE' },
    requestable: false,
    viewUrl: 'http://stash.local/scenes/local-scene-1',
    progressPercent: null,
    ...overrides,
  };
}

function buildFavoriteItem(overrides: Partial<SceneExplorerItem> = {}): SceneExplorerItem {
  return {
    id: 'catalog-scene-1',
    title: 'Favorite Release',
    description: null,
    imageUrl: 'https://stashdb.local/scene-1.jpg',
    cardImageUrl: 'https://stashdb.local/scene-1.jpg',
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: null,
    releaseDate: '2026-04-01',
    duration: 1200,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    requestable: true,
    ...overrides,
  };
}

function buildFavoriteFeed(items: SceneExplorerItem[] = [buildFavoriteItem()]): ScenesFeedResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 16,
    hasMore: false,
    items,
  };
}

function buildSetupStatus(
  overrides: Partial<Omit<SetupStatusResponse, 'required'>> & {
    required?: Partial<SetupStatusResponse['required']>;
  } = {},
): SetupStatusResponse {
  return {
    setupComplete: overrides.setupComplete ?? true,
    required: {
      stash: true,
      catalog: true,
      whisparr: true,
      ...(overrides.required ?? {}),
    },
    catalogProvider: overrides.catalogProvider ?? 'STASHDB',
  };
}

const HEALTHY_RUNTIME_HEALTH: RuntimeHealthResponse = {
  degraded: false,
  failureThreshold: 3,
  services: {
    catalog: {
      service: 'CATALOG',
      status: 'HEALTHY',
      degraded: false,
      consecutiveFailures: 0,
      lastHealthyAt: '2026-04-02T00:00:00.000Z',
      lastFailureAt: null,
      lastErrorMessage: null,
      degradedAt: null,
    },
    stash: {
      service: 'STASH',
      status: 'HEALTHY',
      degraded: false,
      consecutiveFailures: 0,
      lastHealthyAt: '2026-04-02T00:00:00.000Z',
      lastFailureAt: null,
      lastErrorMessage: null,
      degradedAt: null,
    },
    whisparr: {
      service: 'WHISPARR',
      status: 'HEALTHY',
      degraded: false,
      consecutiveFailures: 0,
      lastHealthyAt: '2026-04-02T00:00:00.000Z',
      lastFailureAt: null,
      lastErrorMessage: null,
      degradedAt: null,
    },
  },
};

describe('HomePageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderPage(options?: {
    favoriteFeed?: ScenesFeedResponse;
    favoriteFeedError?: boolean;
    continueWatching?: HomeRailContentResponse;
    recentlyAdded?: HomeRailContentResponse;
    runtimeHealth?: RuntimeHealthResponse;
    setupStatus?: SetupStatusResponse;
  }) {
    const discoverService = {
      getPopularScenes: vi
        .fn()
        .mockReturnValue(of({ total: 0, page: 1, perPage: 0, hasMore: false, items: [] })),
      getPopularPerformers: vi
        .fn()
        .mockReturnValue(of({ total: 0, page: 1, perPage: 0, hasMore: false, items: [] })),
      getScenesFeed: vi
        .fn()
        .mockReturnValue(
          options?.favoriteFeedError
            ? throwError(() => new Error('feed failed'))
            : of(options?.favoriteFeed ?? buildFavoriteFeed()),
        ),
      getPerformersFeed: vi
        .fn()
        .mockReturnValue(of({ total: 0, page: 1, perPage: 5, hasMore: false, items: [] })),
      getStudiosFeed: vi
        .fn()
        .mockReturnValue(of({ total: 0, page: 1, perPage: 5, hasMore: false, items: [] })),
      getSceneRequestOptions: vi.fn().mockReturnValue(of(null)),
      submitSceneRequest: vi.fn().mockReturnValue(of(null)),
    };
    const homeService = {
      getContinueWatching: vi
        .fn()
        .mockReturnValue(of(options?.continueWatching ?? { items: [], message: null })),
      getRecentlyAdded: vi
        .fn()
        .mockReturnValue(of(options?.recentlyAdded ?? { items: [], message: null })),
      resetContinueWatchingProgress: vi.fn().mockReturnValue(of(undefined)),
      // The banner: here, the recently added scenes, as new.
      getHero: vi.fn().mockReturnValue(
        of({
          items: (options?.recentlyAdded?.items ?? []).map((item) => ({
            ...item,
            heroReason: 'NEW',
          })),
        }),
      ),
    };
    const runtimeHealthService = {
      ensureStarted: vi.fn(),
      status: signal(options?.runtimeHealth ?? HEALTHY_RUNTIME_HEALTH).asReadonly(),
    };
    const setupStatusStore = {
      status: signal(options?.setupStatus ?? buildSetupStatus()),
      sync: vi.fn(),
    };
    const playerService = {
      openByLocalSceneId: vi.fn(),
      progressSaved: new Subject<string>(),
    };

    await TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideRouter([]),
        { provide: DiscoverService, useValue: discoverService },
        { provide: HomeService, useValue: homeService },
        { provide: RuntimeHealthService, useValue: runtimeHealthService },
        { provide: SetupStatusStore, useValue: setupStatusStore },
        { provide: PlayerService, useValue: playerService },
        {
          provide: AppNotificationsService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: SceneQuickRequestService,
          useValue: { tryQuickRequest: vi.fn().mockReturnValue(of({ submitted: false })) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(HomePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService, homeService, runtimeHealthService, playerService };
  }

  function railSectionByTitle(
    fixture: ComponentFixture<HomePageComponent>,
    title: string,
  ): HTMLElement {
    const sections = Array.from(
      fixture.nativeElement.querySelectorAll('.rail-section') as NodeListOf<HTMLElement>,
    );
    const section = sections.find(
      (candidate) =>
        candidate.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim() === title,
    );

    expect(section).toBeTruthy();
    return section as HTMLElement;
  }

  it('loads Continue Watching, Recently Added and Popular, without the favourites row', async () => {
    const { fixture, discoverService, homeService, runtimeHealthService } = await renderPage();

    expect(discoverService.getScenesFeed).not.toHaveBeenCalled();
    expect(discoverService.getPopularScenes).toHaveBeenCalledTimes(1);
    expect(homeService.getContinueWatching).toHaveBeenCalledTimes(1);
    expect(homeService.getRecentlyAdded).toHaveBeenCalledTimes(1);
    expect(runtimeHealthService.ensureStarted).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.editor-shell')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Customize Home');
  });

  it('hides Continue Watching and Recently Added when both are empty', async () => {
    const { fixture } = await renderPage();

    const sections = Array.from(
      fixture.nativeElement.querySelectorAll('.rail-section') as NodeListOf<HTMLElement>,
    ).map((section) => section.querySelector('h2')?.textContent?.trim());

    expect(sections).not.toContain('Pick up where you left off');
    expect(sections).not.toContain('Fresh in your library');
  });

  it('renders Continue Watching with a large play button and routes internally when linked', async () => {
    const { fixture, playerService } = await renderPage({
      continueWatching: {
        items: [
          buildRailItem({
            id: 'in-progress-1',
            activeCatalogSceneId: 'catalog-411',
            title: 'Half Watched',
            progressPercent: 42,
          }),
        ],
        message: null,
      },
    });

    const section = railSectionByTitle(fixture, 'Pick up where you left off');
    const progressFill = section.querySelector('.progress-fill') as HTMLElement | null;
    const largePlay = section.querySelector('.play-action') as HTMLButtonElement | null;
    const cardLink = section.querySelector('a.media-link-stretch') as HTMLAnchorElement | null;

    expect(progressFill?.style.width).toBe('42%');
    expect(largePlay).toBeTruthy();
    expect(cardLink?.getAttribute('href')).toContain('/scene/catalog-411');

    largePlay?.click();

    expect(playerService.openByLocalSceneId).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Half Watched',
        localSceneId: 'in-progress-1',
        imageUrl: '/api/media/stash/scenes/local-scene-1/screenshot',
      }),
    );
  });

  it('marks a scene watched and removes it from Continue Watching', async () => {
    const { fixture, homeService } = await renderPage({
      continueWatching: {
        items: [buildRailItem({ id: 'in-progress-3', title: 'To Dismiss' })],
        message: null,
      },
    });

    const section = railSectionByTitle(fixture, 'Pick up where you left off');
    const markWatchedButton = section.querySelector(
      '.mark-watched-button',
    ) as HTMLButtonElement | null;
    expect(markWatchedButton).toBeTruthy();

    markWatchedButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(homeService.resetContinueWatchingProgress).toHaveBeenCalledWith('in-progress-3');
    expect(fixture.nativeElement.textContent).not.toContain('To Dismiss');
  });

  it('routes Continue Watching to the local scene page when no catalog scene is linked', async () => {
    const { fixture } = await renderPage({
      continueWatching: {
        items: [
          buildRailItem({
            id: 'in-progress-2',
            activeCatalogSceneId: null,
            viewUrl: 'http://stash.local/scenes/in-progress-2',
            progressPercent: 10,
          }),
        ],
        message: null,
      },
    });

    const section = railSectionByTitle(fixture, 'Pick up where you left off');
    const largePlay = section.querySelector('.play-action') as HTMLButtonElement | null;
    const cardLink = section.querySelector('a.media-link-stretch') as HTMLAnchorElement | null;

    expect(largePlay).toBeTruthy();
    expect(cardLink?.getAttribute('href')).toMatch(/^\/library\/scene\/in-progress-2\?returnTo=/);
  });

  it('renders Recently Added scenes and routes internally when linked', async () => {
    const { fixture } = await renderPage({
      recentlyAdded: {
        items: [
          buildRailItem({
            id: 'fresh-1',
            activeCatalogSceneId: 'catalog-fresh-1',
            title: 'Fresh Scene',
          }),
        ],
        message: null,
      },
    });

    const section = railSectionByTitle(fixture, 'Fresh in your library');
    const cardLink = section.querySelector('a.media-link-stretch') as HTMLAnchorElement | null;

    expect(section.textContent).toContain('Fresh Scene');
    expect(cardLink?.getAttribute('href')).toContain('/scene/catalog-fresh-1');
  });

  it('shows the empty state when nothing is available anywhere', async () => {
    const { fixture } = await renderPage({ favoriteFeed: buildFavoriteFeed([]) });

    expect(fixture.nativeElement.querySelector('.empty-state')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Browse Scenes');
  });

  it('shows live results under the search box while typing', async () => {
    const { fixture, discoverService } = await renderPage();
    discoverService.getPerformersFeed.mockReturnValue(
      of({
        total: 1,
        page: 1,
        perPage: 5,
        hasMore: false,
        items: [
          {
            id: 'performer-1',
            name: 'Performer One',
            gender: null,
            sceneCount: 3,
            isFavorite: false,
            imageUrl: null,
            cardImageUrl: null,
          },
        ],
      }),
    );
    discoverService.getStudiosFeed.mockReturnValue(
      of({
        total: 1,
        page: 1,
        perPage: 5,
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
      }),
    );

    const searchInput = fixture.nativeElement.querySelector(
      '.hero-search-input',
    ) as HTMLInputElement;
    searchInput.value = 'one';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(discoverService.getScenesFeed).toHaveBeenLastCalledWith(
      1,
      5,
      'TITLE',
      'ASC',
      [],
      undefined,
      undefined,
      [],
      'one',
    );
    expect(discoverService.getPerformersFeed).toHaveBeenCalledWith(1, 4, { name: 'one' });
    expect(discoverService.getStudiosFeed).toHaveBeenCalledWith(1, 3, { name: 'one' });

    const panel = fixture.nativeElement.querySelector(
      '[data-testid="search-suggest"]',
    ) as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('Performer One');
    expect(panel.textContent).toContain('Studio One');
    // Performers, then sites, then scenes.
    expect([...panel.querySelectorAll('.group')].map((label) => label.textContent?.trim())).toEqual(
      ['Performers', 'Sites', 'Scenes'],
    );

    const performerLink = panel.querySelector(
      'a[href="/performer/performer-1"]',
    ) as HTMLAnchorElement | null;
    expect(performerLink).toBeTruthy();
  });

  it('picks up new library scenes when you come back to it, without restarting unchanged rows', async () => {
    const first = buildRailItem({ id: '411', title: 'Already Here' });
    const { fixture, homeService } = await renderPage({
      recentlyAdded: { items: [first], message: null },
    });
    const component = fixture.componentInstance as unknown as {
      lastRefreshAt: number;
      recentlyAddedItems: () => unknown[];
    };
    const comeBack = () => {
      component.lastRefreshAt = 0;
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
    };

    // Nothing new: the row keeps the same list (so the banner isn't restarted).
    const before = component.recentlyAddedItems();
    comeBack();
    expect(homeService.getRecentlyAdded).toHaveBeenCalledTimes(2);
    // The banner is refreshed along with it.
    expect(homeService.getHero).toHaveBeenCalledTimes(2);
    expect(component.recentlyAddedItems()).toBe(before);

    // A scene added in Stash meanwhile shows up.
    homeService.getRecentlyAdded.mockReturnValue(
      of({ items: [buildRailItem({ id: '412', title: 'Just Added' }), first], message: null }),
    );
    comeBack();
    expect(component.recentlyAddedItems().map((item) => (item as { id: string }).id)).toEqual([
      '412',
      '411',
    ]);
  });

  it("follows a scene's place being saved: Continue Watching updates straight away", async () => {
    const { homeService, playerService } = await renderPage();
    expect(homeService.getContinueWatching).toHaveBeenCalledTimes(1);

    // Left a scene (or closed the miniplayer): its place saved.
    playerService.progressSaved.next('411');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(homeService.getContinueWatching).toHaveBeenCalledTimes(2);
  });
});
