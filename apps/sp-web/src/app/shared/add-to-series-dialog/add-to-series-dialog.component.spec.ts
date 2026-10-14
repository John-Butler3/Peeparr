import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { GroupsService } from '../../core/api/groups.service';
import { SeriesDetail } from '../../core/api/groups.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { AddToSeriesDialogComponent } from './add-to-series-dialog.component';

function detail(id: string, name: string, sceneIds: string[]): SeriesDetail {
  return {
    id,
    name,
    date: null,
    studio: null,
    sceneCount: sceneIds.length,
    coverImageUrl: `/api/media/stash/groups/${id}/cover`,
    synopsis: null,
    viewUrl: '',
    scenes: sceneIds.map((sceneId, index) => ({ id: sceneId, sceneIndex: index + 1 }) as never),
  };
}

describe('AddToSeriesDialogComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    const groupsService = {
      getSeries: vi.fn().mockReturnValue(
        of({
          total: 2,
          page: 1,
          perPage: 50,
          hasMore: false,
          items: [
            { id: '5', name: 'Alpha', date: null, studio: null, sceneCount: 2, coverImageUrl: '' },
            { id: '6', name: 'Beta', date: null, studio: null, sceneCount: 1, coverImageUrl: '' },
          ],
        }),
      ),
      getSeriesForScene: vi.fn().mockReturnValue(of([{ id: '6', name: 'Beta', sceneIndex: 1 }])),
      addScene: vi.fn().mockReturnValue(of(detail('5', 'Alpha', ['1', '2', '42']))),
      removeScene: vi.fn().mockReturnValue(of(detail('6', 'Beta', []))),
      createSeries: vi.fn().mockReturnValue(of(detail('7', 'Gamma', ['42']))),
    };

    await TestBed.configureTestingModule({
      imports: [AddToSeriesDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: GroupsService, useValue: groupsService },
        { provide: AppNotificationsService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AddToSeriesDialogComponent);
    const changes: unknown[] = [];
    fixture.componentInstance.membershipsChanged.subscribe((value) => changes.push(value));
    fixture.componentRef.setInput('sceneId', '42');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, groupsService, changes };
  }

  // p-dialog renders into document.body.
  const button = (label: string) =>
    document.body.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;

  it("loads the series list and marks the ones the scene is already in", async () => {
    const { groupsService } = await render();

    expect(groupsService.getSeriesForScene).toHaveBeenCalledWith('42');
    expect(button('Add to Alpha').getAttribute('aria-pressed')).toBe('false');
    expect(button('Remove from Beta').getAttribute('aria-pressed')).toBe('true');
  });

  it('adds the scene to a series and reports its new part number', async () => {
    const { fixture, groupsService, changes } = await render();

    button('Add to Alpha').click();
    fixture.detectChanges();

    expect(groupsService.addScene).toHaveBeenCalledWith('5', '42');
    expect(changes.at(-1)).toEqual([
      { id: '6', name: 'Beta', sceneIndex: 1 },
      { id: '5', name: 'Alpha', sceneIndex: 3 },
    ]);
    expect(button('Remove from Alpha')).toBeTruthy();
  });

  it('removes the scene from a series it is in', async () => {
    const { fixture, groupsService, changes } = await render();

    button('Remove from Beta').click();
    fixture.detectChanges();

    expect(groupsService.removeScene).toHaveBeenCalledWith('6', '42');
    expect(changes.at(-1)).toEqual([]);
  });

  it('creates a new series starting with the scene', async () => {
    const { fixture, groupsService, changes } = await render();

    fixture.componentInstance['newSeriesName'].set('Gamma');
    fixture.componentInstance['createSeries']();
    fixture.detectChanges();

    expect(groupsService.createSeries).toHaveBeenCalledWith({ name: 'Gamma', sceneId: '42' });
    expect(changes.at(-1)).toEqual([
      { id: '6', name: 'Beta', sceneIndex: 1 },
      { id: '7', name: 'Gamma', sceneIndex: 1 },
    ]);
  });
});
