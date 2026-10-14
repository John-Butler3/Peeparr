import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
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

  it('sets loading state immediately, then ready state once the catalog-based source resolves', () => {
    const source: ScenePlaybackSource = {
      streamUrl: 'http://stash.local/stream',
      stashSceneId: '411',
      resumeSeconds: 30,
      duration: 600,
    };
    getSceneStreamUrlMock.mockReturnValue(of(source));

    service.openByCatalogSceneId({
      title: 'A Scene',
      catalogStashId: 'catalog-1',
      imageUrl: 'http://cdn.local/a-scene.jpg',
    });

    expect(service.state()).toEqual({
      status: 'ready',
      title: 'A Scene',
      imageUrl: 'http://cdn.local/a-scene.jpg',
      source,
    });
    expect(getSceneStreamUrlMock).toHaveBeenCalledWith('catalog-1', undefined);
  });

  it('passes the copyId through for catalog-based lookups', () => {
    getSceneStreamUrlMock.mockReturnValue(
      of({ streamUrl: 'x', stashSceneId: '1', resumeSeconds: 0, duration: null }),
    );

    service.openByCatalogSceneId({
      title: 'A Scene',
      catalogStashId: 'catalog-1',
      copyId: 'copy-1',
    });

    expect(getSceneStreamUrlMock).toHaveBeenCalledWith('catalog-1', 'copy-1');
  });

  it('sets an error state when the catalog-based source fails to load', () => {
    getSceneStreamUrlMock.mockReturnValue(throwError(() => new Error('boom')));

    service.openByCatalogSceneId({ title: 'A Scene', catalogStashId: 'catalog-1' });

    expect(service.state()).toEqual({
      status: 'error',
      title: 'A Scene',
      imageUrl: null,
      message: 'Failed to load stream from Stash.',
    });
  });

  it('builds the stream URL directly and fetches resume info by local scene id', () => {
    httpGetMock.mockReturnValue(of({ resumeSeconds: 90, duration: 1200 }));

    service.openByLocalSceneId({
      title: 'Library Scene',
      localSceneId: '411',
      imageUrl: 'http://stash.local/library-scene.jpg',
    });

    expect(httpGetMock).toHaveBeenCalledWith(
      '/api/media/stash/scenes/411/playback-info',
    );
    expect(service.state()).toEqual({
      status: 'ready',
      title: 'Library Scene',
      imageUrl: 'http://stash.local/library-scene.jpg',
      source: {
        streamUrl: '/api/media/stash/scenes/411/stream',
        stashSceneId: '411',
        resumeSeconds: 90,
        duration: 1200,
      },
    });
  });

  it('falls back to no resume position when playback-info fails, rather than blocking playback', () => {
    httpGetMock.mockReturnValue(throwError(() => new Error('boom')));

    service.openByLocalSceneId({ title: 'Library Scene', localSceneId: '411' });

    expect(service.state()).toEqual({
      status: 'ready',
      title: 'Library Scene',
      imageUrl: null,
      source: {
        streamUrl: '/api/media/stash/scenes/411/stream',
        stashSceneId: '411',
        resumeSeconds: 0,
        duration: null,
      },
    });
  });

  it('ignores a stale response after the player has been closed', () => {
    const subject = new Subject<ScenePlaybackSource>();
    getSceneStreamUrlMock.mockReturnValue(subject.asObservable());

    service.openByCatalogSceneId({ title: 'A Scene', catalogStashId: 'catalog-1' });
    service.close();

    subject.next({
      streamUrl: 'http://stash.local/stream',
      stashSceneId: '411',
      resumeSeconds: 0,
      duration: 600,
    });

    expect(service.state()).toBeNull();
  });

  it('ignores a stale response after a second scene was opened', () => {
    const firstSubject = new Subject<ScenePlaybackSource>();
    getSceneStreamUrlMock.mockReturnValueOnce(firstSubject.asObservable());

    service.openByCatalogSceneId({ title: 'First Scene', catalogStashId: 'catalog-1' });

    const secondSource: ScenePlaybackSource = {
      streamUrl: 'http://stash.local/second',
      stashSceneId: '999',
      resumeSeconds: 0,
      duration: 300,
    };
    getSceneStreamUrlMock.mockReturnValueOnce(of(secondSource));
    service.openByCatalogSceneId({ title: 'Second Scene', catalogStashId: 'catalog-2' });

    firstSubject.next({
      streamUrl: 'http://stash.local/first',
      stashSceneId: '411',
      resumeSeconds: 0,
      duration: 600,
    });

    expect(service.state()).toEqual({
      status: 'ready',
      title: 'Second Scene',
      imageUrl: null,
      source: secondSource,
    });
  });

  it('clears state on close', () => {
    getSceneStreamUrlMock.mockReturnValue(
      of({ streamUrl: 'x', stashSceneId: '1', resumeSeconds: 0, duration: null }),
    );
    service.openByCatalogSceneId({ title: 'A Scene', catalogStashId: 'catalog-1' });

    service.close();

    expect(service.state()).toBeNull();
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

  describe('play queue', () => {
    const items = [
      { localSceneId: '11', title: 'Part One', imageUrl: null },
      { localSceneId: '12', title: 'Part Two', imageUrl: null },
    ];

    beforeEach(() => {
      httpGetMock.mockReturnValue(of({ resumeSeconds: 0, duration: 600 }));
    });

    it('plays the queue from the requested part and steps through it', () => {
      service.playQueue('Duo', items, 0);

      expect(service.queue()).toEqual({ name: 'Duo', items, index: 0 });
      expect(service.state()).toEqual(
        expect.objectContaining({ status: 'ready', title: 'Part One' }),
      );
      expect(service.hasNext()).toBe(true);
      expect(service.hasPrevious()).toBe(false);

      expect(service.next()).toBe(true);
      expect(service.queue()?.index).toBe(1);
      expect(service.state()).toEqual(
        expect.objectContaining({
          status: 'ready',
          title: 'Part Two',
          source: expect.objectContaining({ stashSceneId: '12' }),
        }),
      );

      // End of the series: stays on the last part.
      expect(service.next()).toBe(false);
      expect(service.queue()?.index).toBe(1);
      expect(service.previous()).toBe(true);
      expect(service.queue()?.index).toBe(0);
    });

    it('drops the queue when a single scene is opened or the player closes', () => {
      service.playQueue('Duo', items, 1);
      service.openByLocalSceneId({ title: 'Other', localSceneId: '99' });
      expect(service.queue()).toBeNull();

      service.playQueue('Duo', items, 0);
      service.close();
      expect(service.queue()).toBeNull();
      expect(service.next()).toBe(false);
    });
  });
});

