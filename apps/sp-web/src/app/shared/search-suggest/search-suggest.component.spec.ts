import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SearchSuggestComponent } from './search-suggest.component';

@Component({
  imports: [SearchSuggestComponent],
  template: `
    <div style="position: relative">
      <input #box (input)="query.set(box.value)" (keydown.enter)="searched = true" />
      <app-search-suggest [input]="box" [query]="query()" (navigated)="navigated = true" />
    </div>
    <button class="outside">elsewhere</button>
  `,
})
class HostComponent {
  readonly query = signal('');
  searched = false;
  navigated = false;
}

describe('SearchSuggestComponent', () => {
  let discover: {
    getPerformersFeed: ReturnType<typeof vi.fn>;
    getStudiosFeed: ReturnType<typeof vi.fn>;
    getScenesFeed: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    discover = {
      getPerformersFeed: vi.fn().mockReturnValue(
        of({
          items: [
            { id: 'p1', name: 'Anna Example', sceneCount: 9, isFavorite: true, imageUrl: null, cardImageUrl: null },
          ],
        }),
      ),
      getStudiosFeed: vi.fn().mockReturnValue(
        of({ items: [{ id: 's1', name: 'Anchor Studios', isFavorite: false, imageUrl: null, parentStudio: null }] }),
      ),
      getScenesFeed: vi.fn().mockReturnValue(
        of({
          items: [
            {
              id: 'c1',
              title: 'Lakeside Afternoon',
              studio: 'Coastline',
              releaseDate: '2025-03-12',
              imageUrl: null,
              cardImageUrl: null,
              status: { state: 'AVAILABLE' },
            },
          ],
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([]), { provide: DiscoverService, useValue: discover }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function render() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const box = element.querySelector('input') as HTMLInputElement;
    const type = (text: string) => {
      box.value = text;
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      vi.advanceTimersByTime(SearchSuggestComponent.DEBOUNCE_MS + 10);
      fixture.detectChanges();
    };
    const key = (k: string) => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    return { fixture, element, box, type, key };
  }

  it('waits for two letters, then shows performers, sites and scenes', () => {
    const { element, type } = render();

    type('a');
    expect(element.querySelector('[data-testid="search-suggest"]')).toBeNull();
    expect(discover.getPerformersFeed).not.toHaveBeenCalled();

    type('an');
    const panel = element.querySelector('[data-testid="search-suggest"]') as HTMLElement;
    expect([...panel.querySelectorAll('.group')].map((g) => g.textContent?.trim())).toEqual([
      'Performers',
      'Sites',
      'Scenes',
    ]);
    expect(panel.textContent).toContain('See all results for "an"');
    expect(panel.textContent).toContain('Anna Example');
    expect(panel.textContent).toContain('In library');
    expect(discover.getPerformersFeed).toHaveBeenCalledWith(1, SearchSuggestComponent.PERFORMERS, { name: 'an' });
  });

  it('opens the highlighted result with the arrow keys and Enter, instead of the box\'s own search', async () => {
    const { fixture, type, key } = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    type('an');
    key('ArrowDown'); // "See all"
    key('ArrowDown'); // Anna Example
    key('Enter');

    expect(navigate).toHaveBeenCalledWith(['/performer', 'p1'], { queryParams: undefined });
    expect(fixture.componentInstance.searched).toBe(false);
    expect(fixture.componentInstance.navigated).toBe(true);
  });

  it('leaves Enter to the box when nothing is highlighted', () => {
    const { fixture, type, key } = render();

    type('an');
    key('Enter');

    expect(fixture.componentInstance.searched).toBe(true);
  });

  it('closes on Escape and on a tap outside', () => {
    const { element, type, key, fixture } = render();

    type('an');
    key('Escape');
    expect(element.querySelector('[data-testid="search-suggest"]')).toBeNull();

    type('ann');
    expect(element.querySelector('[data-testid="search-suggest"]')).toBeTruthy();
    element.querySelector('.outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="search-suggest"]')).toBeNull();
  });
});
