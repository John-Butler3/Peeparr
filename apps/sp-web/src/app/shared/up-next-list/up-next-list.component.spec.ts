import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UpNextItem, UpNextListComponent } from './up-next-list.component';

function row(overrides: Partial<UpNextItem>): UpNextItem {
  return {
    id: '412',
    title: 'Library Scene',
    imageUrl: '/thumb.jpg',
    studio: null,
    releaseDate: null,
    duration: 600,
    commands: ['/library/scene', '412'],
    ...overrides,
  };
}

function pointer(type: string, pointerType: string): Event {
  const event = new MouseEvent(type);
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

describe('UpNextListComponent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('previews library scenes on hover, but not scenes outside the library', async () => {
    await TestBed.configureTestingModule({
      imports: [UpNextListComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(UpNextListComponent);
    fixture.componentInstance.items = [
      row({ previewKind: 'local' }),
      row({ id: 'catalog-9', title: 'Not In Library', previewKind: null }),
    ];
    fixture.detectChanges();
    const [libraryThumb, otherThumb] = Array.from(
      fixture.nativeElement.querySelectorAll('.thumb'),
    ) as HTMLElement[];

    libraryThumb.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(200);
    expect(libraryThumb.querySelector('video.hover-preview')?.getAttribute('src')).toBe(
      '/api/media/stash/scenes/412/preview',
    );

    otherThumb.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(1000);
    expect(otherThumb.querySelector('video')).toBeNull();
  });
});
