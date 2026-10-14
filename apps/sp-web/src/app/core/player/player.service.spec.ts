import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { DiscoverService } from '../api/discover.service';
import { ScenePlaybackSource } from '../api/discover.types';
import { PlayerService } from './player.service';

describe('PlayerService', () => {
  const getSceneStreamUrlMock = vi.fn();
  const httpGetMock = vi.fn();
  const httpPostMock = vi.fn();

  let service: PlayerService;

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        PlayerService,
        {
          provide: DiscoverService,
          useValue: { getSceneStreamUrl: getSceneStreamUrlMock },
        },
        {
          provide: HttpClient,
          useValue: { get: httpGetMock, post: httpPostMock },
        },
      ],
    });

    service = TestBed.inject(PlayerService);
  });

  it('plays a catalog scene on its own page, autoplaying (no separate watch panel)', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    service.openByCatalogSceneId({ title: 'A Scene', catalogStashId: 'catalog-1' });

    expect(navigate).toHaveBeenCalledWith(['/scene', 'catalog-1'], {
      queryParams: { autoplay: '1' },
    });
    expect(service.state()).toBeNull();
    expect(getSceneStreamUrlMock).not.toHaveBeenCalled();
  });

  it("plays a library scene on the page its details link names, keeping the link's query", () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    service.openByLocalSceneId({
      title: 'Library Scene',
      localSceneId: '411',
      details: { detailsLink: { commands: ['/scene', 'catalog-9'], queryParams: { returnTo: '/home' } } },
    });

    expect(navigate).toHaveBeenCalledWith(['/scene', 'catalog-9'], {
      queryParams: { returnTo: '/home', autoplay: '1' },
    });
  });

  it("plays a series from the chosen part's page (its next parts follow from Up next)", () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    service.playQueue(
      'Duo',
      [
        { localSceneId: '11', title: 'Part One', imageUrl: null },
        { localSceneId: '12', title: 'Part Two', imageUrl: null },
      ],
      1,
    );

    expect(navigate).toHaveBeenCalledWith(['/library/scene', '12'], {
      queryParams: { autoplay: '1' },
    });
    expect(service.queue()).toBeNull();
  });

  it('builds the stream URL directly and fetches resume info by local scene id', () => {
    httpGetMock.mockReturnValue(of({ resumeSeconds: 90, duration: 1200 }));
    let source: ScenePlaybackSource | undefined;

    service.resolveLocalSource('411').subscribe((value) => (source = value));

    expect(httpGetMock).toHaveBeenCalledWith('/api/media/stash/scenes/411/playback-info');
    expect(source).toEqual({
      streamUrl: '/api/media/stash/scenes/411/stream',
      stashSceneId: '411',
      resumeSeconds: 90,
      duration: 1200,
    });
  });

  it('falls back to no resume position when playback-info fails, rather than blocking playback', () => {
    httpGetMock.mockReturnValue(throwError(() => new Error('boom')));
    let source: ScenePlaybackSource | undefined;

    service.resolveLocalSource('411').subscribe((value) => (source = value));

    expect(source).toEqual({
      streamUrl: '/api/media/stash/scenes/411/stream',
      stashSceneId: '411',
      resumeSeconds: 0,
      duration: null,
    });
  });

  it('hands the miniplayer position back to the scene page once', () => {
    service.handBack('411', 42);

    expect(service.takeHandBack('999')).toBeNull();
    expect(service.takeHandBack('411')).toBe(42);
    expect(service.takeHandBack('411')).toBeNull();
  });

  it('posts resume position and play duration to save progress', () => {
    httpPostMock.mockReturnValue(of(undefined));

    service.saveProgress('411', 123.4, 600);

    expect(httpPostMock).toHaveBeenCalledWith(
      '/api/media/stash/scenes/411/progress',
      { resumeSeconds: 123.4, playDuration: 600 },
    );
  });

  it('omits playDuration from the save payload when unknown', () => {
    httpPostMock.mockReturnValue(of(undefined));

    service.saveProgress('411', 123.4, null);

    expect(httpPostMock).toHaveBeenCalledWith(
      '/api/media/stash/scenes/411/progress',
      { resumeSeconds: 123.4 },
    );
  });

  it('does not save progress for a negative or non-finite resume position', () => {
    service.saveProgress('411', -1, 600);
    service.saveProgress('411', Number.NaN, 600);

    expect(httpPostMock).not.toHaveBeenCalled();
  });

  it('swallows save-progress errors rather than throwing', () => {
    httpPostMock.mockReturnValue(throwError(() => new Error('boom')));

    expect(() => service.saveProgress('411', 10, 600)).not.toThrow();
  });
});
