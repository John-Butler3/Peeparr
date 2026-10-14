import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LibraryService } from '../../../core/api/library.service';
import { LibrarySceneItem, LibrarySearchResponse } from '../../../core/api/library.types';
import { PlayerService } from '../../../core/player/player.service';
import { LibrarySearchComponent } from './library-search.component';

function buildScene(id: string): LibrarySceneItem {
  return {
    id,
    activeCatalogSceneId: `stash-${id}`,
    title: `Scene ${id}`,
    description: null,
    imageUrl: null,
    cardImageUrl: null,
    studioId: null,
    studio: 'Archive',
    studioImageUrl: null,
    performerNames: ['Performer One'],
    releaseDate: '2026-03-24',
    duration: 1800,
    localCreatedAt: null,
    type: 'SCENE',
    source: 'STASH',
    viewUrl: `http://stash.local/scenes/${id}`,
  };
}

function buildResponse(overrides: Partial<LibrarySearchResponse> = {}): LibrarySearchResponse {
  return {
    query: 'one',
    scenes: {
      total: 8,
      page: 1,
      perPage: 6,
      hasMore: true,
      items: ['1', '2', '3', '4', '5', '6'].map(buildScene),
    },
    performers: [
      { id: '7', name: 'Performer One', imageUrl: '/api/media/stash/performers/7/photo', sceneCount: 5 },
    ],
    studios: [{ id: '3', name: 'One Studio', imageUrl: null, sceneCount: 2 }],
    tags: [{ id: '12', name: 'One Tag', sceneCount: 1 }],
    ...overrides,
  };
}

describe('LibrarySearchComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  async function render(response: LibrarySearchResponse | Error = buildResponse()) {
    vi.useFakeTimers();
    const libraryService = {
      search: vi
        .fn()
        .mockReturnValue(response instanceof Error ? throwError(() => response) : of(response)),
      searchScenes: vi.fn().mockReturnValue(
        of({ total: 8, page: 2, perPage: 6, hasMore: false, items: ['7', '8'].map(buildScene) }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [LibrarySearchComponent],
      providers: [
        provideRouter([]),
        { provide: LibraryService, useValue: libraryService },
        { provide: PlayerService, useValue: { openByLocalSceneId: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LibrarySearchComponent);
    fixture.componentRef.setInput('query', '  one ');
    fixture.detectChanges();
    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    return { fixture, libraryService };
  }

  it('shows the first scenes plus matching performers, sites and tags', async () => {
    const { fixture, libraryService } = await render();
    const element = fixture.nativeElement as HTMLElement;

    expect(libraryService.search).toHaveBeenCalledWith('one', 5);
    expect(element.querySelectorAll('app-scene-card')).toHaveLength(6);
    expect(element.querySelector('#library-search-scenes')?.textContent).toContain('8');

    const performerLink = element.querySelector('a[aria-label="Library scenes with Performer One"]');
    expect(performerLink?.getAttribute('href')).toBe(
      '/library?performers=7&performerNames=Performer%20One',
    );
    expect(performerLink?.textContent).toContain('5 scenes');
    expect(
      element.querySelector('a[aria-label="Library scenes from One Studio"]')?.getAttribute('href'),
    ).toBe('/library?studios=3&studioNames=One%20Studio');
    expect(
      element.querySelector('a[aria-label="Library scenes tagged One Tag"]')?.getAttribute('href'),
    ).toBe('/library?tags=12&tagNames=One%20Tag');
  });

  it('loads the next scenes with "Show more" and hides it once everything is shown', async () => {
    const { fixture, libraryService } = await render();
    const element = fixture.nativeElement as HTMLElement;
    const showMore = element.querySelector(
      '[data-testid="library-search-show-more"]',
    ) as HTMLButtonElement;

    expect(showMore.textContent).toContain('Show more');

    showMore.click();
    fixture.detectChanges();

    expect(libraryService.searchScenes).toHaveBeenCalledWith('one', 2, 5);
    expect(element.querySelectorAll('app-scene-card')).toHaveLength(8);
    expect(element.querySelector('[data-testid="library-search-show-more"]')).toBeNull();
  });

  it('says so when nothing in the library matches', async () => {
    const { fixture } = await render(
      buildResponse({
        scenes: { total: 0, page: 1, perPage: 6, hasMore: false, items: [] },
        performers: [],
        studios: [],
        tags: [],
      }),
    );

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="library-search-empty"]')
        ?.textContent,
    ).toContain('No library matches for "one"');
  });

  it('shows an error with a retry when the search request fails', async () => {
    const { fixture, libraryService } = await render(new Error('boom'));
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Library search failed.');

    libraryService.search.mockReturnValue(of(buildResponse()));
    (element.querySelector('.retry-button') as HTMLButtonElement).click();
    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    expect(element.querySelectorAll('app-scene-card')).toHaveLength(6);
  });
});
