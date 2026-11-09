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

const SEED = expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/);

describe('PurgeSettingsPageComponent', () => {
  const getShuffledPage = vi.fn();
  const deleteNow = vi.fn();
  const notifyError = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    getShuffledPage.mockReset();
    deleteNow.mockReset();
    notifyError.mockReset();
    TestBed.configureTestingModule({
      imports: [PurgeSettingsPageComponent],
      providers: [
        provideRouter([]),
        { provide: LibraryService, useValue: { getShuffledPage } },
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

  function tally(fixture: ReturnType<typeof render>) {
    return fixture.nativeElement.querySelector('[data-testid="purge-tally"]').textContent;
  }

  function settle(fixture: ReturnType<typeof render>) {
    vi.advanceTimersByTime(PurgeSettingsPageComponent.FLY_MS + 10);
    fixture.detectChanges();
  }

  it('starts on request with a fresh shuffle, the first scene dealt on top: picture and title', () => {
    getShuffledPage.mockReturnValue(of(feed([scene('1'), scene('2')])));
    const fixture = render();
    expect(getShuffledPage).not.toHaveBeenCalled();

    click(fixture, 'purge-start');

    expect(getShuffledPage).toHaveBeenCalledWith(SEED, 1, PurgeSettingsPageComponent.PER_PAGE);
    expect(title(fixture)).toBe('Scene 1');
    const image = fixture.nativeElement.querySelector(
      '[data-testid="purge-card"] img',
    ) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('/api/media/stash/scenes/1/screenshot');
  });

  it('keeps a scene: on to the next, nothing deleted, nothing stored', () => {
    getShuffledPage.mockReturnValue(of(feed([scene('1'), scene('2')])));
    const fixture = render();
    click(fixture, 'purge-start');

    click(fixture, 'purge-keep');
    settle(fixture);

    expect(title(fixture)).toBe('Scene 2');
    expect(deleteNow).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(tally(fixture)).toContain('1 kept');
  });

  it('deletes a scene at once, with no asking, and moves on', () => {
    getShuffledPage.mockReturnValue(of(feed([scene('1'), scene('2')])));
    deleteNow.mockReturnValue(of({ deletedStashSceneIds: ['1'], removedFromWhisparr: true }));
    const fixture = render();
    click(fixture, 'purge-start');

    click(fixture, 'purge-delete');

    expect(deleteNow).toHaveBeenCalledWith({ stashSceneIds: ['1'], catalogSceneId: 'cat-1' });
    settle(fixture);
    expect(title(fixture)).toBe('Scene 2');
    expect(tally(fixture)).toContain('1 deleted');
  });

  it('puts a scene back on top when deleting it fails, and says why', () => {
    getShuffledPage.mockReturnValue(of(feed([scene('1'), scene('2')])));
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
    getShuffledPage.mockReturnValue(of(feed([scene('1'), scene('2')])));
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

  it('as the deck runs low, loads the page after the kept ones, from the same shuffle', () => {
    const perPage = PurgeSettingsPageComponent.PER_PAGE;
    const total = perPage + 3;
    const firstPage = Array.from({ length: perPage }, (_, i) => scene(`a${i}`));
    const secondPage = [scene('b1'), scene('b2'), scene('b3')];
    getShuffledPage
      .mockReturnValueOnce(of(feed(firstPage, total, true)))
      .mockReturnValueOnce(of({ ...feed(secondPage, total), page: 2 }));
    const fixture = render();
    click(fixture, 'purge-start');
    const [seed] = getShuffledPage.mock.calls[0] as [string];

    // Kept down to the low-water mark: the next page is asked for.
    const toKeep = perPage - PurgeSettingsPageComponent.LOW_WATER;
    for (let i = 0; i < toKeep; i += 1) {
      click(fixture, 'purge-keep');
      settle(fixture);
    }

    expect(getShuffledPage).toHaveBeenCalledTimes(2);
    expect(getShuffledPage).toHaveBeenLastCalledWith(seed, 2, perPage);
    expect(title(fixture)).toBe(`Scene a${toKeep}`);
    expect(tally(fixture)).toContain(`${total - toKeep} to go`);
  });

  it('says when everything has been gone through, and shuffles anew on request', () => {
    getShuffledPage.mockReturnValue(of(feed([scene('1')])));
    const fixture = render();
    click(fixture, 'purge-start');
    const [firstSeed] = getShuffledPage.mock.calls[0] as [string];
    click(fixture, 'purge-keep');
    settle(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="purge-finished"]')).toBeTruthy();

    (
      fixture.nativeElement.querySelector('[data-testid="purge-finished"] button') as HTMLElement
    ).click();
    fixture.detectChanges();
    const [secondSeed] = getShuffledPage.mock.calls[1] as [string];
    expect(secondSeed).not.toBe(firstSeed);
    expect(title(fixture)).toBe('Scene 1');
    expect(tally(fixture)).toContain('0 kept');
  });

  it('shows the error and offers a retry when the library cannot be loaded', () => {
    getShuffledPage.mockReturnValueOnce(
      throwError(() => ({ error: { message: 'Stash is down.' } })),
    );
    const fixture = render();
    click(fixture, 'purge-start');
    expect(fixture.nativeElement.textContent).toContain('Stash is down.');

    getShuffledPage.mockReturnValue(of(feed([scene('1')])));
    (fixture.nativeElement.querySelector('.state-shell button') as HTMLElement).click();
    fixture.detectChanges();
    expect(title(fixture)).toBe('Scene 1');
  });
});
