import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { GroupsService } from '../../core/api/groups.service';
import { LibraryService } from '../../core/api/library.service';
import { LibrarySceneDetail } from '../../core/api/library.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { PlayerService } from '../../core/player/player.service';
import { WatchProgressService } from '../../core/player/watch-progress.service';
import { LocalScenePageComponent } from './local-scene-page.component';

function buildScene(overrides: Partial<LibrarySceneDetail> = {}): LibrarySceneDetail {
  return {
    id: '412',
    activeCatalogSceneId: null,
    title: 'Home Movie',
    description: 'Shot locally.',
    imageUrl: '/api/media/stash/scenes/412/screenshot',
    cardImageUrl: '/api/media/stash/scenes/412/screenshot',
    studioId: null,
    studio: 'Archive',
    studioImageUrl: null,
    performerNames: ['Performer One'],
    releaseDate: '2026-01-02',
    duration: 3725,
    localCreatedAt: null,
    type: 'SCENE',
    source: 'STASH',
    viewUrl: 'http://stash.local/scenes/412',
    libraryStudioId: '3',
    performers: [{ id: '7', name: 'Performer One', imageUrl: '/api/media/stash/performers/7/photo' }],
    tags: [{ id: '12', name: 'Outdoor' }],
    ...overrides,
  };
}

describe('LocalScenePageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(
    options: { scene?: LibrarySceneDetail | Error; returnTo?: string; watched?: boolean } = {},
  ) {
    const scene = options.scene ?? buildScene();
    const libraryService = {
      getScene: vi
        .fn()
        .mockReturnValue(scene instanceof Error ? throwError(() => scene) : of(scene)),
      getRecommended: vi
        .fn()
        .mockReturnValue(of({ items: [buildScene({ id: '500', title: 'Recommended Pick' })] })),
    };
    const groupsService = {
      getSeriesForScene: vi.fn().mockReturnValue(of([{ id: '5', name: 'Trilogy', sceneIndex: 2 }])),
      getSeries: vi.fn().mockReturnValue(of({ total: 0, page: 1, perPage: 50, hasMore: false, items: [] })),
      getSeriesDetail: vi.fn().mockReturnValue(
        of({
          id: '5',
          name: 'Trilogy',
          date: null,
          studio: null,
          sceneCount: 3,
          coverImageUrl: '',
          synopsis: null,
          viewUrl: '',
          scenes: [
            { ...buildScene({ id: '300', title: 'Part One' }), sceneIndex: 1 },
            { ...buildScene(), sceneIndex: 2 },
            { ...buildScene({ id: '500', title: 'Recommended Pick' }), sceneIndex: 3 },
          ],
        }),
      ),
    };
    const playerService = {
      close: vi.fn(),
      saveProgress: vi.fn(),
      handOff: vi.fn(),
      resolveLocalSource: vi.fn().mockReturnValue(
        of({ streamUrl: '/api/media/stash/scenes/412/stream', stashSceneId: '412', resumeSeconds: 0, duration: 3725 }),
      ),
    };
    const queryParams = options.returnTo ? { returnTo: options.returnTo } : {};
    let watched = options.watched ?? false;
    const watchProgress = {
      percentFor: vi.fn(() => null),
      record: vi.fn(),
      refresh: vi.fn(),
      isWatched: vi.fn(() => watched),
      markUnwatched: vi.fn(() => {
        watched = false;
        return of(undefined);
      }),
    };
    const notifications = { success: vi.fn(), error: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [LocalScenePageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: LibraryService, useValue: libraryService },
        { provide: GroupsService, useValue: groupsService },
        { provide: PlayerService, useValue: playerService },
        { provide: AppNotificationsService, useValue: notifications },
        { provide: WatchProgressService, useValue: watchProgress },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ sceneId: '412' })),
            snapshot: {
              paramMap: convertToParamMap({ sceneId: '412' }),
              queryParamMap: convertToParamMap(queryParams),
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LocalScenePageComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    return {
      fixture,
      router,
      libraryService,
      playerService,
      watchProgress,
      notifications,
      element: fixture.nativeElement as HTMLElement,
    };
  }

  it('offers Mark as unwatched only for a watched scene, and clears it', async () => {
    const unwatched = await render();
    expect(unwatched.element.querySelector('[data-testid="local-scene-mark-unwatched"]')).toBeNull();
    TestBed.resetTestingModule();

    const { element, fixture, watchProgress, notifications } = await render({ watched: true });
    const button = element.querySelector<HTMLButtonElement>('[data-testid="local-scene-mark-unwatched"]');
    expect(button?.textContent).toContain('Mark as unwatched');

    button!.click();
    fixture.detectChanges();

    expect(watchProgress.markUnwatched).toHaveBeenCalledWith(['412']);
    expect(notifications.success).toHaveBeenCalledWith('Marked as unwatched');
    expect(element.querySelector('[data-testid="local-scene-mark-unwatched"]')).toBeNull();
  });

  it('shows the scene from the library index with a link out to Stash', async () => {
    const { element, libraryService } = await render();

    expect(libraryService.getScene).toHaveBeenCalledWith('412');
    expect(element.querySelector('h1')?.textContent).toContain('Home Movie');
    expect(element.querySelector('.still-duration')?.textContent).toContain('1:02:05');
    expect(
      element.querySelector('[data-testid="local-scene-open-in-stash"]')?.getAttribute('href'),
    ).toBe('http://stash.local/scenes/412');
    expect(element.querySelector('[data-testid="local-scene-series"]')?.textContent).toContain(
      'Part 2 of',
    );
  });

  it('links performers, studio and tags into the filtered library', async () => {
    const { element } = await render();

    expect(
      element.querySelector('a[aria-label="Library scenes with Performer One"]')?.getAttribute('href'),
    ).toBe('/library?performers=7&performerNames=Performer%20One');
    expect(element.querySelector('.studio-link')?.getAttribute('href')).toBe(
      '/library?studios=3&studioNames=Archive',
    );
    expect(element.querySelector('.tag-link')?.getAttribute('href')).toBe(
      '/library?tags=12&tagNames=Outdoor',
    );
  });

  it('plays the scene in place of its thumbnail', async () => {
    const { fixture, element, playerService, libraryService } = await render();

    (element.querySelector('[data-testid="inline-player-poster"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(playerService.resolveLocalSource).toHaveBeenCalledWith('412');
    expect(element.querySelector('.watch-media video')?.getAttribute('src')).toBe(
      '/api/media/stash/scenes/412/stream',
    );
    expect(libraryService.getRecommended).toHaveBeenCalledWith('412');
  });

  it('puts the next part of the series first in Up next and autoplays it', async () => {
    const { fixture, element, router } = await render();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const titles = Array.from(element.querySelectorAll('.up-next .title')).map((el) =>
      el.textContent?.trim(),
    );
    // Part 3 first, then the remaining recommendations without repeating it.
    expect(titles).toEqual(['Recommended Pick']);
    expect(element.querySelector('.up-next .label')?.textContent).toContain('Part 3 · Trilogy');

    (fixture.componentInstance as any).playNextUp();
    expect(navigate).toHaveBeenCalledWith(['/library/scene', '500'], {
      queryParams: { autoplay: '1' },
    });
  });

  it('goes back to the page that linked here, but only for in-app paths', async () => {
    const fromSeries = await render({ returnTo: '/series/5' });
    expect(fromSeries.element.querySelector('.app-back-link')?.getAttribute('href')).toBe('/series/5');
    TestBed.resetTestingModule();

    const offsite = await render({ returnTo: '//evil.example' });
    expect(offsite.element.querySelector('.app-back-link')?.getAttribute('href')).toBe('/library');
  });

  it('explains when the scene is not in the library index', async () => {
    const { element } = await render({ scene: new Error('404') });

    expect(element.textContent).toContain('not in the local library index');
  });
});
