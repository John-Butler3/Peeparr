import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AcquisitionService } from '../../core/api/acquisition.service';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import { PlayerService } from '../../core/player/player.service';
import { GroupsService } from '../../core/api/groups.service';
import { LibraryService } from '../../core/api/library.service';
import { SceneDetails } from '../../core/api/discover.types';
import { ScenePageComponent } from './scene-page.component';

function buildScene(overrides: Partial<SceneDetails> = {}): SceneDetails {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/image.jpg',
    images: [],
    studioId: 'studio-1',
    studioIsFavorite: false,
    studio: 'Studio',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    studioUrl: 'http://studio.local',
    releaseDate: '2026-03-01',
    duration: 600,
    tags: [],
    performers: [],
    sourceUrls: [],
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    stash: null,
    whisparr: null,
    ...overrides,
  };
}

describe('ScenePageComponent', () => {
  async function renderScene(scene: SceneDetails) {
    const discoverService = {
      getSceneDetails: vi.fn().mockReturnValue(of(scene)),
      getSceneStreamUrl: vi.fn().mockReturnValue(
        of({
          streamUrl: 'http://stash.local/stream?apikey=secret',
          stashSceneId: 'stash-scene-1',
          resumeSeconds: 0,
          duration: 600,
        }),
      ),
      getSimilarScenes: vi.fn().mockReturnValue(of({ items: [] })),
    };
    const activatedRoute = {
      paramMap: of(convertToParamMap({ stashId: scene.id })),
      queryParamMap: of(convertToParamMap({})),
      snapshot: {
        paramMap: convertToParamMap({ stashId: scene.id }),
      },
    };

    const playerService = {
      openByCatalogSceneId: vi.fn(),
      close: vi.fn(),
      saveProgress: vi.fn(),
      handOff: vi.fn(),
      resolveLocalSource: vi.fn().mockReturnValue(
        of({
          streamUrl: '/api/media/stash/scenes/stash-scene-1/stream',
          stashSceneId: 'stash-scene-1',
          resumeSeconds: 0,
          duration: 600,
        }),
      ),
    };
    const libraryService = {
      getRecommended: vi.fn().mockReturnValue(of({ items: [] })),
    };

    const acquisitionService = {
      removeSceneRequest: vi.fn().mockReturnValue(
        of({ removed: true, stashId: scene.id, whisparrMovieId: null }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [ScenePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: AppNotificationsService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
        {
          provide: PlayerService,
          useValue: playerService,
        },
        { provide: LibraryService, useValue: libraryService },
        { provide: GroupsService, useValue: { getSeriesForScene: vi.fn().mockReturnValue(of([])) } },
        {
          provide: AcquisitionService,
          useValue: acquisitionService,
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
        {
          provide: SceneQuickRequestService,
          useValue: { tryQuickRequest: vi.fn().mockReturnValue(of({ submitted: false })) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ScenePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService, playerService, acquisitionService, libraryService };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('links the studio logo to the internal studio page, not an external URL', async () => {
    const scene = buildScene();

    const { fixture } = await renderScene(scene);

    const studioLink = fixture.nativeElement.querySelector(
      'a.channel',
    ) as HTMLAnchorElement | null;

    expect(studioLink?.getAttribute('href')).toContain('/studio/studio-1');
    expect(studioLink?.getAttribute('target')).toBeNull();
  });

  it('falls back to an external studio link when there is no internal studioId', async () => {
    const scene = buildScene({ studioId: null });

    const { fixture } = await renderScene(scene);

    const studioLink = fixture.nativeElement.querySelector(
      'a.channel',
    ) as HTMLAnchorElement | null;

    expect(studioLink?.getAttribute('href')).toBe('http://studio.local');
    expect(studioLink?.getAttribute('target')).toBe('_blank');
  });

  it('shows failed guidance, keeps the Whisparr link, and hides the request button for failed scenes', async () => {
    const scene = buildScene({
      status: { state: 'FAILED' },
      whisparr: {
        exists: true,
        viewUrl: 'http://whisparr.local/movie/scene-1',
      },
    });

    const { fixture, discoverService } = await renderScene(scene);
    const text = fixture.nativeElement.textContent;

    expect(discoverService.getSceneDetails).toHaveBeenCalledWith('scene-1');
    expect(text).toContain('Resolve or retry this download in Whisparr.');
    expect(text).not.toContain('Retry in Whisparr');
    expect(fixture.nativeElement.querySelector('.pill--primary')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('a[href="http://whisparr.local/movie/scene-1"]')
        ?.textContent,
    ).toContain('Whisparr');
  });

  it('keeps the normal request CTA for NOT_REQUESTED scenes', async () => {
    const { fixture } = await renderScene(buildScene());

    // Request sits beside the title.
    const requestButton = fixture.nativeElement.querySelector(
      '.watch-title-row .watch-title-action',
    ) as HTMLButtonElement | null;
    expect(requestButton?.getAttribute('aria-label')).toBe('Request in Whisparr');
  });

  it('plays the linked stash copy in place of the thumbnail', async () => {
    const scene = buildScene({
      stash: {
        exists: true,
        hasMultipleCopies: false,
        copies: [
          {
            id: 'stash-scene-1',
            viewUrl: 'http://stash.local/scenes/stash-scene-1',
            width: 1920,
            height: 1080,
            label: '1080p',
          },
        ],
      },
    });

    const { fixture, playerService, libraryService } = await renderScene(scene);

    // YouTube-style watch page: the thumbnail is the player.
    const poster = fixture.nativeElement.querySelector(
      '[data-testid="inline-player-poster"]',
    ) as HTMLButtonElement;
    expect(poster).not.toBeNull();

    poster.click();
    fixture.detectChanges();

    expect(playerService.resolveLocalSource).toHaveBeenCalledWith('stash-scene-1');
    expect(playerService.close).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.watch-media video')?.getAttribute('src')).toBe(
      '/api/media/stash/scenes/stash-scene-1/stream',
    );
    // Up next comes from the library recommendations for the Stash copy.
    expect(libraryService.getRecommended).toHaveBeenCalledWith('stash-scene-1');
  });
});
