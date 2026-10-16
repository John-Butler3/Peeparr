import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { GalleriesService } from '../../core/api/galleries.service';
import { GalleryFeedItem, GalleryImage } from '../../core/api/galleries.types';
import { GalleryPageComponent } from './gallery-page.component';

const gallery: GalleryFeedItem = {
  id: 'g1',
  title: 'Beach day',
  description: null,
  coverImageUrl: null,
  studioId: null,
  studio: null,
  studioImageUrl: null,
  performers: [],
  tagIds: [],
  tagNames: [],
  imageCount: 3,
  releaseDate: null,
  viewUrl: '',
  createdAt: null,
  updatedAt: null,
};

const image = (id: string): GalleryImage => ({
  id,
  title: null,
  imageUrl: `/api/media/stash/images/${id}/full`,
  thumbnailUrl: `/api/media/stash/images/${id}/thumbnail`,
  width: 6000,
  height: 4000,
});

// jsdom loads no pictures: report one as loaded at the given size.
function loadFull(img: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(img, 'currentSrc', {
    configurable: true,
    value: `http://localhost${img.getAttribute('src')}`,
  });
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height });
  img.dispatchEvent(new Event('load'));
}

describe('GalleryPageComponent image viewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function render(
    getGalleryImages: (id: string, page: number) => unknown = () =>
      of({
        total: 3,
        page: 1,
        perPage: 60,
        hasMore: false,
        items: [image('1'), image('2'), image('3')],
      }),
  ) {
    await TestBed.configureTestingModule({
      imports: [GalleryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ galleryId: 'g1' })) },
        },
        {
          provide: GalleriesService,
          useValue: {
            getGalleryById: () => of(gallery),
            getGalleryImages,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GalleryPageComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const open = (index: number) => {
      element.querySelectorAll<HTMLButtonElement>('.image-tile')[index].click();
      fixture.detectChanges();
    };
    const current = '.viewer-panel.is-current';
    const full = () => element.querySelector<HTMLImageElement>(`${current} .viewer-full`)!;
    return { fixture, element, open, full };
  }

  it('shows the thumbnail at once, then the full-resolution picture over it', async () => {
    const { fixture, element, open, full } = await render();
    open(1);

    expect(element.querySelector('.is-current .viewer-thumb')?.getAttribute('src')).toBe(
      '/api/media/stash/images/2/thumbnail',
    );
    expect(full().getAttribute('src')).toBe('/api/media/stash/images/2/full');
    expect(full().classList).not.toContain('ready');
    expect(element.querySelector('.viewer-loading')?.textContent).toContain(
      'Loading full resolution',
    );

    loadFull(full(), 6000, 4000);
    fixture.detectChanges();

    expect(full().classList).toContain('ready');
    expect(element.querySelector('.is-current .viewer-thumb')).toBeNull();
    expect(element.querySelector('.viewer-loading')).toBeNull();
  });

  it('the pictures either side wait off screen and slide in, already loaded', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const { fixture, element, open, full } = await render();
    open(1);
    const panel = (side: string) =>
      element.querySelector<HTMLImageElement>(`.viewer-panel.is-${side} .viewer-full`)!;
    expect(panel('previous').getAttribute('src')).toBe('/api/media/stash/images/1/full');
    expect(panel('next').getAttribute('src')).toBe('/api/media/stash/images/3/full');

    // The next one finishes loading while waiting off screen.
    const nextImage = panel('next');
    loadFull(nextImage, 6000, 4000);
    fixture.detectChanges();
    Object.defineProperty(element.querySelector('.viewer-stage'), 'clientWidth', { value: 800 });

    element.querySelector<HTMLButtonElement>('.viewer-next')!.click();
    const track = element.querySelector<HTMLElement>('.viewer-track')!;
    vi.advanceTimersByTime(100);
    // Sliding: the strip moves (both pictures go across together).
    expect(track.style.transform).toMatch(/translate3d\(-\d+/);
    vi.advanceTimersByTime(400);
    fixture.detectChanges();

    // Arrived: the same picture element is now the current one, ready at
    // once (no reload, no thumbnail), and the strip is back in place.
    expect(full()).toBe(nextImage);
    expect(full().classList).toContain('ready');
    expect(element.querySelector('.is-current .viewer-thumb')).toBeNull();
    expect(track.style.transform).toBe('');
    expect(element.querySelector('.viewer-panel.is-next')).toBeNull();
    vi.useRealTimers();
  });

  it('grid tiles keep the shape of each picture, so none is cropped', async () => {
    const { element } = await render();
    const tiles = [...element.querySelectorAll<HTMLElement>('.image-tile')];

    expect(tiles.map((tile) => tile.style.getPropertyValue('--ar'))).toEqual(['1.5', '1.5', '1.5']);
  });

  it('zooms the photo, not the page: a click zooms it, Esc fits it again', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const { fixture, element, open, full } = await render();
    open(0);
    loadFull(full(), 6000, 4000);
    for (const [key, value] of Object.entries({
      offsetWidth: 600,
      offsetHeight: 400,
      offsetLeft: 0,
      offsetTop: 0,
    })) {
      Object.defineProperty(full(), key, { configurable: true, value });
    }
    fixture.detectChanges();
    expect(element.querySelector<HTMLElement>('.viewer-stage')!.style.touchAction).toBe('none');
    expect(element.querySelector('.viewer-hint')).not.toBeNull();

    const at = (type: string, time: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: 300, clientY: 200, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      Object.defineProperty(event, 'timeStamp', { value: time });
      full().dispatchEvent(event);
    };
    at('pointerdown', 0);
    at('pointerup', 50);
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(full().style.transform).toContain('scale(');
    expect(element.querySelector('.viewer-hint')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(400);
    fixture.detectChanges();
    expect(full().style.transform).toBe('');
    // Still open: the first Esc only zooms back out.
    expect(element.querySelector('.image-viewer-overlay')).not.toBeNull();
    vi.useRealTimers();
  });

  it('loads more images by itself when scrolled near the end', async () => {
    let reportNear: ((near: boolean) => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          reportNear = (near) => callback([{ isIntersecting: near }]);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const pages: number[] = [];
    const { fixture, element } = await render((_id, page) => {
      pages.push(page);
      return of({
        total: 9,
        page,
        perPage: 3,
        hasMore: page < 3,
        items: [1, 2, 3].map((n) => image(`${page}-${n}`)),
      });
    });
    expect(pages).toEqual([1]);

    // Scrolled near the end: the next page loads, and, still near the end
    // (a tall screen), the one after.
    reportNear!(true);
    await Promise.resolve();
    fixture.detectChanges();
    expect(pages).toEqual([1, 2, 3]);
    expect(element.querySelectorAll('.image-tile').length).toBe(9);
    expect(element.querySelector('.load-more-images')).toBeNull();

    vi.unstubAllGlobals();
  });
});
