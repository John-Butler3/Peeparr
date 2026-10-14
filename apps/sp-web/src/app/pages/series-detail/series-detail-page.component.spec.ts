import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { BehaviorSubject, of } from 'rxjs';
import { GroupsService } from '../../core/api/groups.service';
import { SeriesDetail, SeriesScene } from '../../core/api/groups.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { PlayerService } from '../../core/player/player.service';
import { SeriesDetailPageComponent } from './series-detail-page.component';

function part(id: string, sceneIndex: number | null): SeriesScene {
  return {
    id,
    sceneIndex,
    activeCatalogSceneId: id === '11' ? 'catalog-11' : null,
    title: `Part ${id}`,
    description: null,
    imageUrl: `/api/media/stash/scenes/${id}/screenshot`,
    cardImageUrl: `/api/media/stash/scenes/${id}/screenshot`,
    studioId: null,
    studio: null,
    studioImageUrl: null,
    performerNames: [],
    releaseDate: null,
    duration: 1200,
    localCreatedAt: null,
    type: 'SCENE',
    source: 'STASH',
    viewUrl: `http://stash.local/scenes/${id}`,
  };
}

function buildSeries(scenes = [part('11', 1), part('12', 2), part('13', 3)]): SeriesDetail {
  return {
    id: '5',
    name: 'Trilogy',
    date: null,
    studio: null,
    sceneCount: scenes.length,
    coverImageUrl: '/api/media/stash/groups/5/cover',
    synopsis: null,
    viewUrl: 'http://stash.local/groups/5',
    scenes,
  };
}

describe('SeriesDetailPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(series = buildSeries()) {
    const groupsService = {
      getSeriesDetail: vi.fn().mockReturnValue(of(series)),
      reorderScenes: vi.fn().mockReturnValue(of(series)),
      removeScene: vi.fn().mockReturnValue(of(buildSeries([part('11', 1), part('13', 2)]))),
      updateSeries: vi.fn(),
      deleteSeries: vi.fn(),
    };
    const playerService = { playQueue: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SeriesDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: GroupsService, useValue: groupsService },
        { provide: PlayerService, useValue: playerService },
        { provide: AppNotificationsService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: ConfirmationService, useValue: { confirm: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ seriesId: '5' })),
            snapshot: { paramMap: convertToParamMap({ seriesId: '5' }) },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SeriesDetailPageComponent);
    fixture.detectChanges();
    return { fixture, groupsService, playerService, element: fixture.nativeElement as HTMLElement };
  }

  it('lists the parts in order with the total running time', async () => {
    const { element, groupsService } = await render();

    expect(groupsService.getSeriesDetail).toHaveBeenCalledWith('5');
    expect(
      Array.from(element.querySelectorAll('.part-number')).map((node) => node.textContent?.trim()),
    ).toEqual(['Part 1', 'Part 2', 'Part 3']);
    expect(element.querySelector('.series-meta')?.textContent).toContain('3 parts');
    expect(element.querySelector('.series-meta')?.textContent).toContain('1 h 0 min');
    expect(element.querySelector('a.part-title')?.getAttribute('href')).toContain('/scene/catalog-11');
  });

  it('plays every part in order with "Play all", or from a chosen part', async () => {
    const { element, playerService } = await render();

    (element.querySelector('[data-testid="series-play-all"]') as HTMLButtonElement).click();
    expect(playerService.playQueue).toHaveBeenCalledWith(
      'Trilogy',
      [
        expect.objectContaining({ localSceneId: '11', title: 'Part 11', imageUrl: '/api/media/stash/scenes/11/screenshot' }),
        expect.objectContaining({ localSceneId: '12', title: 'Part 12', imageUrl: '/api/media/stash/scenes/12/screenshot' }),
        expect.objectContaining({ localSceneId: '13', title: 'Part 13', imageUrl: '/api/media/stash/scenes/13/screenshot' }),
      ],
      0,
    );

    (element.querySelectorAll('.part-thumb')[2] as HTMLButtonElement).click();
    expect(playerService.playQueue).toHaveBeenLastCalledWith('Trilogy', expect.any(Array), 2);
  });

  it('moves a part by swapping it with its neighbour', async () => {
    const { element, groupsService } = await render();

    (element.querySelector('[aria-label="Move Part 12 down"]') as HTMLButtonElement).click();

    expect(groupsService.reorderScenes).toHaveBeenCalledWith('5', ['11', '13', '12']);
    expect((element.querySelector('[aria-label="Move Part 11 up"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('removes a part and shows the updated list', async () => {
    const { fixture, element, groupsService } = await render();

    (element.querySelector('[aria-label="Remove Part 12 from series"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(groupsService.removeScene).toHaveBeenCalledWith('5', '12');
    expect(element.querySelectorAll('.part')).toHaveLength(2);
  });
});
