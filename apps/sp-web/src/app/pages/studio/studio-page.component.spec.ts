import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { DiscoverItem, StudioDetails } from '../../core/api/discover.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneQuickRequestService } from '../../core/requests/scene-quick-request.service';
import { StudioPageComponent } from './studio-page.component';

function buildStudio(overrides: Partial<StudioDetails> = {}): StudioDetails {
  return {
    id: 'studio-1',
    name: 'Studio One',
    aliases: [],
    deleted: false,
    isFavorite: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-03-01',
    imageUrl: 'http://cdn.local/studio.jpg',
    images: [],
    urls: [],
    parentStudio: null,
    childStudios: [],
    ...overrides,
  };
}

function buildScene(overrides: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 'scene-1',
    title: 'Studio Scene',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/scene.jpg',
    cardImageUrl: 'http://cdn.local/scene-card.jpg',
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-20',
    duration: 1800,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    ...overrides,
  };
}

describe('StudioPageComponent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function renderPage(options?: { items?: DiscoverItem[] }) {
    const items = options?.items ?? [buildScene()];
    const paramMap$ = new BehaviorSubject(convertToParamMap({ studioId: 'studio-1' }));
    const queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    const discoverService = {
      getStudioDetails: vi.fn().mockReturnValue(of(buildStudio())),
      getScenesFeed: vi.fn().mockReturnValue(
        of({
          total: items.length,
          page: 1,
          perPage: 24,
          hasMore: false,
          items,
        }),
      ),
      searchSceneTags: vi.fn().mockReturnValue(of([])),
    };

    await TestBed.configureTestingModule({
      imports: [StudioPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
          },
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
          provide: SceneQuickRequestService,
          useValue: { tryQuickRequest: vi.fn().mockReturnValue(of({ submitted: false })) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(StudioPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture };
  }

  it('renders studio scenes with the shared scene card and keeps request handling on the page', async () => {
    const { fixture } = await renderPage();
    const component = fixture.componentInstance as any;
    const cards = fixture.nativeElement.querySelectorAll('app-scene-card');
    const requestButton = fixture.nativeElement.querySelector('.request-action') as
      | HTMLButtonElement
      | null;

    expect(cards).toHaveLength(1);
    expect(component.requestModalOpen()).toBe(false);

    requestButton?.click();

    expect(component.requestModalOpen()).toBe(true);
    expect(component.requestContext()).toEqual({
      id: 'scene-1',
      title: 'Studio Scene',
      imageUrl: 'http://cdn.local/scene.jpg',
    });
  });

  it('filters to library-only scenes when the toggle is enabled', async () => {
    const { fixture } = await renderPage({
      items: [
        buildScene({ id: 'scene-library', status: { state: 'AVAILABLE' } }),
        buildScene({ id: 'scene-not-library', status: { state: 'NOT_REQUESTED' } }),
      ],
    });
    const component = fixture.componentInstance as any;

    expect(fixture.nativeElement.querySelectorAll('app-scene-card')).toHaveLength(2);

    component.onLibraryOnlyChanged(true);
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('app-scene-card');
    expect(cards).toHaveLength(1);
    expect(component.displayedScenes()).toEqual([
      expect.objectContaining({ id: 'scene-library' }),
    ]);

    component.onLibraryOnlyChanged(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('app-scene-card')).toHaveLength(2);
  });
});
