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

  async function render() {
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
            getGalleryImages: () =>
              of({
                total: 3,
                page: 1,
                perPage: 60,
                hasMore: false,
                items: [image('1'), image('2'), image('3')],
              }),
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
    const full = () => element.querySelector<HTMLImageElement>('.viewer-full')!;
    return { fixture, element, open, full };
  }

  it('shows the thumbnail at once, then the full-resolution picture over it', async () => {
    const { fixture, element, open, full } = await render();
    open(1);

    expect(element.querySelector('.viewer-thumb')?.getAttribute('src')).toBe(
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
    expect(element.querySelector('.viewer-thumb')).toBeNull();
    expect(element.querySelector('.viewer-loading')).toBeNull();
  });

  it('waits again for the next picture, and preloads the neighbours', async () => {
    const created: HTMLImageElement[] = [];
    const RealImage = window.Image;
    vi.spyOn(window, 'Image').mockImplementation(function () {
      const img = new RealImage();
      created.push(img);
      return img;
    } as unknown as () => HTMLImageElement);
    const { fixture, element, open, full } = await render();
    open(1);
    expect(created.map((img) => img.getAttribute('src'))).toEqual([
      '/api/media/stash/images/3/full',
      '/api/media/stash/images/1/full',
    ]);

    loadFull(full(), 6000, 4000);
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.viewer-next')!.click();
    fixture.detectChanges();

    expect(full().getAttribute('src')).toBe('/api/media/stash/images/3/full');
    expect(full().classList).not.toContain('ready');
  });

  it('tapping a large picture zooms to actual pixels, tapping again fits it', async () => {
    const { fixture, element, open, full } = await render();
    open(0);
    loadFull(full(), 6000, 4000);
    fixture.detectChanges();
    const stage = element.querySelector('.viewer-stage')!;
    expect(element.querySelector('.viewer-hint')?.textContent).toContain('Tap to zoom');

    full().click();
    fixture.detectChanges();
    expect(stage.classList).toContain('zoomed');
    // Tapping around a zoomed picture is for panning, not closing.
    (stage as HTMLElement).click();
    fixture.detectChanges();
    expect(element.querySelector('.image-viewer-overlay')).not.toBeNull();

    full().click();
    fixture.detectChanges();
    expect(stage.classList).not.toContain('zoomed');
  });

  it('a picture that already fits the screen does not zoom', async () => {
    const { fixture, element, open, full } = await render();
    open(0);
    loadFull(full(), 200, 100);
    fixture.detectChanges();

    full().click();
    fixture.detectChanges();
    expect(element.querySelector('.viewer-stage')!.classList).not.toContain('zoomed');
    expect(element.querySelector('.viewer-hint')).toBeNull();
  });
});
