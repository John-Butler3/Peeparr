import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { GalleriesService } from '../../core/api/galleries.service';
import { GalleryFeedItem, GalleryImage } from '../../core/api/galleries.types';
import { NavigationHistoryService } from '../../core/navigation/navigation-history.service';
import { BackLinkDirective } from '../../shared/back-link/back-link.directive';
import { PinchZoomDirective } from '../../shared/pinch-zoom/pinch-zoom.directive';

@Component({
  selector: 'app-gallery-page',
  imports: [
    BackLinkDirective,
    PinchZoomDirective,
    RouterLink,
    Message,
    ProgressSpinner,
    ButtonDirective,
  ],
  templateUrl: './gallery-page.component.html',
  styleUrl: './gallery-page.component.scss',
})
export class GalleryPageComponent implements OnInit, OnDestroy {
  private static readonly IMAGES_PAGE_SIZE = 60;

  private readonly route = inject(ActivatedRoute);
  private readonly galleriesService = inject(GalleriesService);
  private routeSubscription: Subscription | null = null;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly gallery = signal<GalleryFeedItem | null>(null);
  protected readonly navigationHistory = inject(NavigationHistoryService);
  // Names this screen for the next one's "Back to ..." button.
  private readonly nameForBackButton = effect(() =>
    this.navigationHistory.setLabel(this.gallery()?.title),
  );

  protected readonly images = signal<GalleryImage[]>([]);
  protected readonly imagesTotal = signal(0);
  protected readonly imagesPage = signal(0);
  protected readonly imagesHasMore = signal(true);
  protected readonly loadingImages = signal(false);
  protected readonly loadingMoreImages = signal(false);
  protected readonly imagesError = signal<string | null>(null);

  protected readonly viewerIndex = signal<number | null>(null);
  /** Full-size URL that has finished loading. */
  private readonly viewerLoadedUrl = signal<string | null>(null);
  protected readonly viewerZoomed = signal(false);
  // Decorator, not viewChild(): the JIT-compiled specs don't see signal queries.
  @ViewChild(PinchZoomDirective) private pinchZoom?: PinchZoomDirective;

  protected readonly viewerFullLoaded = computed(() => {
    const url = this.currentViewerImage()?.imageUrl;
    return !url || this.viewerLoadedUrl() === url;
  });

  protected readonly zoomHint =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
      ? 'Pinch or double-tap to zoom'
      : 'Click or scroll to zoom';

  // Each new picture starts fitted, and the ones either side load in the
  // background so stepping through is instant.
  private readonly onViewerImageChange = effect(() => {
    const index = this.viewerIndex();
    this.viewerZoomed.set(false);
    this.pinchZoom?.reset();
    if (index === null) {
      return;
    }
    const images = untracked(this.images);
    for (const neighbour of [images[index + 1], images[index - 1]]) {
      if (neighbour?.imageUrl) {
        new Image().src = neighbour.imageUrl;
      }
    }
  });

  private galleryId: string | null = null;
  private imagesInFlight = false;

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe((paramMap) => {
      const galleryId = paramMap.get('galleryId')?.trim();
      if (!galleryId) {
        this.error.set('Gallery id is missing from the route.');
        this.loading.set(false);
        return;
      }

      this.galleryId = galleryId;
      this.loadGallery(galleryId);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  protected retry(): void {
    if (this.galleryId) {
      this.loadGallery(this.galleryId);
    }
  }

  protected retryLoadMoreImages(): void {
    this.imagesError.set(null);
    this.loadNextImagesPage();
  }

  protected loadMoreImages(): void {
    this.loadNextImagesPage();
  }

  protected openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  protected closeViewer(): void {
    this.viewerIndex.set(null);
  }

  protected showPreviousImage(): void {
    const index = this.viewerIndex();
    if (index === null) {
      return;
    }
    if (index > 0) {
      this.viewerIndex.set(index - 1);
      return;
    }
    if (this.imagesHasMore()) {
      this.loadNextImagesPage();
    }
  }

  protected showNextImage(): void {
    const index = this.viewerIndex();
    if (index === null) {
      return;
    }
    if (index < this.images().length - 1) {
      this.viewerIndex.set(index + 1);
      return;
    }
    if (this.imagesHasMore() && !this.imagesInFlight) {
      this.loadNextImagesPage();
    }
  }

  protected onViewerFullLoaded(event: Event, image: GalleryImage): void {
    const element = event.target as HTMLImageElement;
    if (image.imageUrl && element.currentSrc.endsWith(image.imageUrl)) {
      this.viewerLoadedUrl.set(image.imageUrl);
    }
  }

  /** Width / height for the grid tile, so the whole picture shows. */
  protected aspectRatio(image: GalleryImage): number {
    const ratio = image.width && image.height ? image.width / image.height : 1;
    // Keep panoramas and very tall pictures from taking over a row.
    return Math.min(3, Math.max(0.4, ratio));
  }

  protected currentViewerImage(): GalleryImage | null {
    const index = this.viewerIndex();
    if (index === null) {
      return null;
    }
    return this.images()[index] ?? null;
  }

  @HostListener('document:keydown', ['$event'])
  protected handleKeydown(event: KeyboardEvent): void {
    if (this.viewerIndex() === null) {
      return;
    }

    if (event.key === 'Escape') {
      if (this.viewerZoomed()) {
        this.pinchZoom?.reset(true);
        return;
      }
      this.closeViewer();
    } else if (event.key === 'ArrowLeft') {
      this.showPreviousImage();
    } else if (event.key === 'ArrowRight') {
      this.showNextImage();
    }
  }

  private loadGallery(galleryId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.images.set([]);
    this.imagesTotal.set(0);
    this.imagesPage.set(0);
    this.imagesHasMore.set(true);

    this.galleriesService
      .getGalleryById(galleryId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (gallery) => {
          this.gallery.set(gallery);
          this.loadNextImagesPage();
        },
        error: (err: unknown) => {
          this.error.set(`Failed to load gallery details.${this.describeServerError(err)}`);
        },
      });
  }

  private loadNextImagesPage(): void {
    if (this.imagesInFlight || !this.imagesHasMore() || !this.galleryId) {
      return;
    }

    const nextPage = this.imagesPage() + 1;
    const isInitialPage = nextPage === 1;
    this.imagesInFlight = true;

    if (isInitialPage) {
      this.loadingImages.set(true);
    } else {
      this.loadingMoreImages.set(true);
    }
    this.imagesError.set(null);

    this.galleriesService
      .getGalleryImages(this.galleryId, nextPage, GalleryPageComponent.IMAGES_PAGE_SIZE)
      .pipe(
        finalize(() => {
          this.imagesInFlight = false;
          this.loadingImages.set(false);
          this.loadingMoreImages.set(false);
        }),
      )
      .subscribe({
        next: (response) => {
          this.imagesTotal.set(response.total);
          this.imagesPage.set(response.page);
          this.imagesHasMore.set(response.hasMore);
          this.images.update((current) =>
            isInitialPage ? response.items : [...current, ...response.items],
          );
        },
        error: (err: unknown) => {
          this.imagesError.set(
            `Failed to load images for this gallery.${this.describeServerError(err)}`,
          );
        },
      });
  }

  // Surfaces the backend's actual error message (e.g. a Stash GraphQL
  // failure relayed via BadGatewayException) instead of a generic string,
  // so a real failure is distinguishable from Stash genuinely having
  // nothing to return.
  private describeServerError(err: unknown): string {
    if (!(err instanceof HttpErrorResponse)) {
      return '';
    }

    const body: unknown = err.error;
    let message: string | undefined;

    if (typeof body === 'string') {
      message = body;
    } else if (body && typeof body === 'object' && 'message' in body) {
      const rawMessage = (body as { message?: unknown }).message;
      message = Array.isArray(rawMessage) ? rawMessage.join(' ') : String(rawMessage ?? '');
    }

    const detail = message?.trim();
    return detail ? ` (${err.status}: ${detail})` : err.status ? ` (HTTP ${err.status})` : '';
  }
}
