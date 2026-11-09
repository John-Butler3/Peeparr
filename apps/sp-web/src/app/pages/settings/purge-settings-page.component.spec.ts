import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryService } from '../../core/api/library.service';
import { LibrarySceneItem } from '../../core/api/library.types';
import { LibraryDeletionService } from '../../core/library/library-deletion.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { PurgeSettingsPageComponent } from './purge-settings-page.component';

function scene(id: string, title = `Scene ${id}`): LibrarySceneItem {
  return {
    id,
    activeCatalogSceneId: `cat-${id}`,
    title,
    description: null,
    imageUrl: `/api/media/stash/scenes/${id}/screenshot`,
    cardImageUrl: null,
    studioId: null,
    studio: 'A Site',
    studioImageUrl: null,
    performerNames: ['Ann'],
    releaseDate: '2024-01-02',
    duration: 125,
    localCreatedAt: null,
    type: 'SCENE',
    source: 'STASH',
    viewUrl: 'http://stash.local/scenes/' + id,
  };
}

function feed(items: LibrarySceneItem[], total = items.length, hasMore = false) {
  return { total, page: 1, perPage: 24, hasMore, latestSyncAt: null, items };
}

describe('PurgeSettingsPageComponent', () => {
  const getScenesFeed = vi.fn();
  const deleteNow = vi.fn();
  const notifyError = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    getScenesFeed.mockReset();
    deleteNow.mockReset();
    notifyError.mockReset();
    TestBed.configureTestingModule({
      imports: [PurgeSettingsPageComponent],
      providers: [
        provideRouter([]),
        { provide: LibraryService, useValue: { getScenesFeed } },
        { provide: LibraryDeletionService, useValue: { deleteNow } },
        { provide: AppNotificationsService, useValue: { error: notifyError, success: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function render() {
    const fixture = TestBed.createComponent(PurgeSettingsPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  function click(fixture: ReturnType<typeof render>, testId: string) {
    const button = fixture.nativeElement.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
  }

  function title(fixture: ReturnType<typeof render>) {
    return fixture.nativeElement.querySelector('[data-testid="purge-title"]')?.textContent?.trim();
  }

  function settle(fixture: ReturnType<typeof render>) {
    vi.advanceTimersByTime(PurgeSettingsPageComponent.FLY_MS + 10);
    fixture.detectChanges();
  }

  it('starts on request, with the oldest-added scene on top: its picture and title', () => {
    getScenesFeed.mockReturnValue(of(feed([scene('1'), scene('2')])));
    const fixture = render();
    expect(getScenesFeed).not.toHaveBeenCalled();

    click(fixture, 'purge-start');

    expect(getScenesFeed).toHaveBeenCalledWith(1, PurgeSettingsPageComponent.PER_PAGE, {
      sort: 'CREATED_AT',
      direction: 'ASC',
    });
    expect(title(fixture)).toBe('Scene 1');
    const image = fixture.nativeElement.querySelector(
      '[data-testid="purge-card"] img',
    ) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('/api/media/stash/scenes/1/screenshot');
  });

  it('keeps a scene: on to the next, nothing deleted, and remembered on this device', () => {
    getScenesFeed.mockReturnValue(of(feed([scene('1'), scene('2')])));
    const fixture = render();
    click(fixture, 'purge-start');

    click(fixture, 'purge-keep');
    settle(fixture);

    expect(title(fixture)).toBe('Scene 2');
    expect(deleteNow).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('peeparr.purge.kept') ?? '[]')).toEqual(['1']);
    expect(
      fixture.nativeElement.querySelector('[data-testid="purge-tally"]').textContent,
    ).toContain('1 kept');
  });

  it('deletes a scene at once, with no asking, and moves on', () => {
    getScenesFeed.mockReturnValue(of(feed([scene('1'), scene('2')])));
    deleteNow.mockReturnValue(of({ deletedStashSceneIds: ['1'], removedFromWhisparr: true }));
    const fixture = render();
    click(fixture, 'purge-start');

    click(fixture, 'purge-delete');

    expect(deleteNow).toHaveBeenCalledWith({ stashSceneIds: ['1'], catalogSceneId: 'cat-1' });
    settle(fixture);
    expect(title(fixture)).toBe('Scene 2');
    expect(
      fixture.nativeElement.querySelector('[data-testid="purge-tally"]').textContent,
    ).toContain('1 deleted');
  });

  it('puts a scene back on top when deleting it fails, and says why', () => {
    getScenesFeed.mockReturnValue(of(feed([scene('1'), scene('2')])));
    const failure = new Subject<never>();
    deleteNow.mockReturnValue(failure);
    const fixture = render();
    click(fixture, 'purge-start');

    click(fixture, 'purge-delete');
    settle(fixture);
    expect(title(fixture)).toBe('Scene 2');

    failure.error({ error: { message: "Stash couldn't delete the scene." } });
    fixture.detectChanges();

    expect(title(fixture)).toBe('Scene 1');
    expect(notifyError).toHaveBeenCalledWith(
      'Couldn\'t delete "Scene 1"',
      "Stash couldn't delete the scene.",
    );
  });

  it('a swipe left of the card deletes, a short drag snaps back', () => {
    getScenesFeed.mockReturnValue(of(feed([scene('1'), scene('2')])));
    deleteNow.mockReturnValue(of({ deletedStashSceneIds: ['1'], removedFromWhisparr: false }));
    const fixture = render();
    click(fixture, 'purge-start');
    const card = () =>
      fixture.nativeElement.querySelector('[data-testid="purge-card"]') as HTMLElement;
    const pointer = (type: string, x: number) =>
      card().dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: 100, button: 0, bubbles: true }),
      );

    // Not far enough: back where it was.
    pointer('pointerdown', 200);
    pointer('pointermove', 150);
    pointer('pointerup', 150);
    fixture.detectChanges();
    expect(deleteNow).not.toHaveBeenCalled();
    expect(card().style.transform).toBe('');

    pointer('pointerdown', 200);
    pointer('pointermove', 200 - PurgeSettingsPageComponent.SWIPE_PX - 20);
    pointer('pointerup', 200 - PurgeSettingsPageComponent.SWIPE_PX - 20);
    fixture.detectChanges();
    expect(deleteNow).toHaveBeenCalledWith({ stashSceneIds: ['1'], catalogSceneId: 'cat-1' });
    settle(fixture);
    expect(title(fixture)).toBe('Scene 2');
  });

  it('carries on past scenes kept on an earlier visit, loading the page after them', () => {
    const keptBefore = Array.from({ length: 24 }, (_, i) => `k${i}`);
    localStorage.setItem('peeparr.purge.kept', JSON.stringify(keptBefore));
    getScenesFeed.mockReturnValue(of({ ...feed([scene('30')], 25, false), page: 2 }));
    const fixture = render();

    expect(fixture.nativeElement.textContent).toContain('Carry on');
    click(fixture, 'purge-start');

    expect(getScenesFeed).toHaveBeenCalledWith(2, PurgeSettingsPageComponent.PER_PAGE, {
      sort: 'CREATED_AT',
      direction: 'ASC',
    });
    expect(title(fixture)).toBe('Scene 30');
  });

  it('says when everything has been gone through, and can start over', () => {
    getScenesFeed.mockReturnValue(of(feed([scene('1')])));
    const fixture = render();
    click(fixture, 'purge-start');
    click(fixture, 'purge-keep');
    settle(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="purge-finished"]')).toBeTruthy();

    getScenesFeed.mockReturnValue(of(feed([scene('1')])));
    (
      fixture.nativeElement.querySelector('[data-testid="purge-finished"] button') as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(title(fixture)).toBe('Scene 1');
    expect(localStorage.getItem('peeparr.purge.kept')).toBe('[]');
  });

  it('shows the error and offers a retry when the library cannot be loaded', () => {
    getScenesFeed.mockReturnValueOnce(throwError(() => ({ error: { message: 'Stash is down.' } })));
    const fixture = render();
    click(fixture, 'purge-start');
    expect(fixture.nativeElement.textContent).toContain('Stash is down.');

    getScenesFeed.mockReturnValue(of(feed([scene('1')])));
    (fixture.nativeElement.querySelector('.state-shell button') as HTMLElement).click();
    fixture.detectChanges();
    expect(title(fixture)).toBe('Scene 1');
  });
});
