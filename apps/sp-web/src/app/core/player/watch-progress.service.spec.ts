import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WatchProgressService } from './watch-progress.service';

describe('WatchProgressService', () => {
  let service: WatchProgressService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WatchProgressService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads watch history once and answers for Stash and catalog ids', () => {
    expect(service.percentFor('411')).toBeNull();
    http.expectOne('/api/home/watch-progress').flush({
      items: [
        { id: '411', activeCatalogSceneId: 'catalog-1', progressPercent: 40 },
        { id: '412', activeCatalogSceneId: null, progressPercent: 100 },
      ],
    });

    expect(service.percentFor('411')).toBe(40);
    expect(service.percentFor('catalog-1')).toBe(40);
    expect(service.percentFor('412')).toBe(100);
    expect(service.percentFor('999')).toBeNull();
    http.expectNone('/api/home/watch-progress');
  });

  it('updates straight away when playback saves a position', () => {
    service.percentFor('411');
    http.expectOne('/api/home/watch-progress').flush({
      items: [{ id: '411', activeCatalogSceneId: 'catalog-1', progressPercent: 10 }],
    });

    service.record('411', 300, 600);
    expect(service.percentFor('411')).toBe(50);
    expect(service.percentFor('catalog-1')).toBe(50);

    service.record('500', 590, 600);
    expect(service.percentFor('500')).toBe(100);
  });

  it("doesn't let a list asked for before clearing undo it", () => {
    service.percentFor('411');
    http.expectOne('/api/home/watch-progress').flush({
      items: [{ id: '411', activeCatalogSceneId: null, progressPercent: 60 }],
    });
    service.refresh();
    const before = http.expectOne('/api/home/watch-progress');

    service.markUnwatched(['411']).subscribe();
    before.flush({ items: [{ id: '411', activeCatalogSceneId: null, progressPercent: 60 }] });

    expect(service.percentFor('411')).toBeNull();
    http.match('/api/home/watch-progress');
    http.expectOne('/api/home/watch-progress/411/unwatched').flush(null);
    http.match('/api/home/watch-progress');
  });

  it('marks scenes unwatched and drops their progress straight away', () => {
    service.percentFor('411');
    http.expectOne('/api/home/watch-progress').flush({
      items: [
        { id: '411', activeCatalogSceneId: 'catalog-1', progressPercent: 100 },
        { id: '412', activeCatalogSceneId: null, progressPercent: 30 },
      ],
    });
    expect(service.isWatched(['411'])).toBe(true);

    let done = false;
    service.markUnwatched(['411']).subscribe(() => (done = true));
    const request = http.expectOne('/api/home/watch-progress/411/unwatched');
    expect(request.request.method).toBe('POST');
    // Gone at once, not waiting for the server.
    expect(service.percentFor('411')).toBeNull();
    request.flush(null);

    expect(done).toBe(true);
    http.expectOne('/api/home/watch-progress').flush({
      items: [{ id: '412', activeCatalogSceneId: null, progressPercent: 30 }],
    });
    expect(service.isWatched(['411'])).toBe(false);
    expect(service.percentFor('catalog-1')).toBeNull();
    expect(service.percentFor('412')).toBe(30);
  });

  it('brings the progress back when marking unwatched fails', () => {
    service.percentFor('411');
    http.expectOne('/api/home/watch-progress').flush({
      items: [{ id: '411', activeCatalogSceneId: null, progressPercent: 60 }],
    });

    let failed = false;
    service.markUnwatched(['411']).subscribe({ error: () => (failed = true) });
    http
      .expectOne('/api/home/watch-progress/411/unwatched')
      .flush('Stash is down', { status: 502, statusText: 'Bad Gateway' });

    expect(failed).toBe(true);
    http.expectOne('/api/home/watch-progress').flush({
      items: [{ id: '411', activeCatalogSceneId: null, progressPercent: 60 }],
    });
    expect(service.percentFor('411')).toBe(60);
  });
});
