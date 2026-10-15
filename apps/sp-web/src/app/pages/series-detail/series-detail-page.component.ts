import { Component, OnDestroy, OnInit, inject, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Observable, Subscription } from 'rxjs';
import { GroupsService } from '../../core/api/groups.service';
import { SeriesDetail, SeriesScene } from '../../core/api/groups.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { PlayerService } from '../../core/player/player.service';
import { libraryScenePlayerDetails } from '../../core/player/player-details.util';
import { WatchProgressService } from '../../core/player/watch-progress.service';
import { ScenePreviewService } from '../../shared/scene-card/scene-preview.service';
import {
  ScenePreviewDirective,
  ScenePreviewLoader,
} from '../../shared/scene-preview/scene-preview.directive';
import { NavigationHistoryService } from '../../core/navigation/navigation-history.service';
import { BackLinkDirective } from '../../shared/back-link/back-link.directive';

@Component({
  selector: 'app-series-detail-page',
  imports: [BackLinkDirective, FormsModule, RouterLink, Message, ProgressSpinner, ScenePreviewDirective],
  templateUrl: './series-detail-page.component.html',
  styleUrl: './series-detail-page.component.scss',
})
export class SeriesDetailPageComponent implements OnInit, OnDestroy {
  private readonly groupsService = inject(GroupsService);
  private readonly playerService = inject(PlayerService);
  private readonly watchProgress = inject(WatchProgressService);
  private readonly previewService = inject(ScenePreviewService);
  private readonly previewLoaders = new Map<string, ScenePreviewLoader>();
  private readonly notifications = inject(AppNotificationsService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private paramSubscription: Subscription | null = null;
  private loadSubscription: Subscription | null = null;

  protected readonly series = signal<SeriesDetail | null>(null);
  protected readonly navigationHistory = inject(NavigationHistoryService);
  // Names this screen for the next one's "Back to ..." button.
  private readonly nameForBackButton = effect(() => this.navigationHistory.setLabel(this.series()?.name));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  // Any write in flight (reorder/remove/edit/delete): disables the controls.
  protected readonly saving = signal(false);
  protected readonly editing = signal(false);
  protected readonly editName = signal('');
  protected readonly editSynopsis = signal('');

  ngOnInit(): void {
    this.paramSubscription = this.route.paramMap.subscribe((params) => {
      this.load(params.get('seriesId') ?? '');
    });
  }

  ngOnDestroy(): void {
    this.paramSubscription?.unsubscribe();
    this.loadSubscription?.unsubscribe();
  }

  protected retry(): void {
    this.load(this.route.snapshot.paramMap.get('seriesId') ?? '');
  }

  protected playAll(startIndex = 0): void {
    const series = this.series();
    if (!series || series.scenes.length === 0) {
      return;
    }

    this.playerService.playQueue(
      series.name,
      series.scenes.map((scene) => ({
        localSceneId: scene.id,
        title: scene.title,
        imageUrl: scene.cardImageUrl ?? scene.imageUrl,
        details: libraryScenePlayerDetails(scene),
      })),
      startIndex,
    );
  }

  protected moveScene(index: number, step: -1 | 1): void {
    const series = this.series();
    const target = index + step;
    if (!series || this.saving() || target < 0 || target >= series.scenes.length) {
      return;
    }

    const ids = series.scenes.map((scene) => scene.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.write(this.groupsService.reorderScenes(series.id, ids), 'Failed to reorder parts');
  }

  protected removeScene(scene: SeriesScene): void {
    const series = this.series();
    if (!series || this.saving()) {
      return;
    }

    this.write(
      this.groupsService.removeScene(series.id, scene.id),
      'Failed to remove from series',
      `Removed "${scene.title}"`,
    );
  }

  protected startEdit(): void {
    const series = this.series();
    if (!series) {
      return;
    }

    this.editName.set(series.name);
    this.editSynopsis.set(series.synopsis ?? '');
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected saveEdit(): void {
    const series = this.series();
    const name = this.editName().trim();
    if (!series || !name || this.saving()) {
      return;
    }

    this.write(
      this.groupsService.updateSeries(series.id, { name, synopsis: this.editSynopsis().trim() }),
      'Failed to save series',
      undefined,
      () => this.editing.set(false),
    );
  }

  protected confirmDelete(): void {
    const series = this.series();
    if (!series || this.saving()) {
      return;
    }

    this.confirmationService.confirm({
      key: 'app-destructive',
      header: 'Delete series?',
      message: `Delete "${series.name}"? Its scenes stay in your library; only the series is removed.`,
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: 'Delete series',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteSeries(series.id),
    });
  }

  protected partLabel(scene: SeriesScene, index: number): string {
    return `Part ${scene.sceneIndex ?? index + 1}`;
  }

  protected totalDurationLabel(): string | null {
    const seconds = (this.series()?.scenes ?? []).reduce(
      (sum, scene) => sum + (scene.duration ?? 0),
      0,
    );
    if (seconds <= 0) {
      return null;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
  }

  protected durationLabel(seconds: number | null): string | null {
    if (!seconds || seconds <= 0) {
      return null;
    }

    const minutes = Math.floor(seconds / 60);
    const rest = String(Math.floor(seconds % 60)).padStart(2, '0');
    return `${minutes}:${rest}`;
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  private deleteSeries(seriesId: string): void {
    this.saving.set(true);
    this.groupsService.deleteSeries(seriesId).subscribe({
      next: () => {
        this.saving.set(false);
        this.notifications.success('Series deleted');
        void this.router.navigate(['/series']);
      },
      error: () => {
        this.saving.set(false);
        this.notifications.error('Failed to delete series');
      },
    });
  }

  private write(
    request: Observable<SeriesDetail>,
    errorMessage: string,
    successMessage?: string,
    onSuccess?: () => void,
  ): void {
    this.saving.set(true);
    request.subscribe({
      next: (series) => {
        this.saving.set(false);
        this.series.set(series);
        onSuccess?.();
        if (successMessage) {
          this.notifications.success(successMessage);
        }
      },
      error: () => {
        this.saving.set(false);
        this.notifications.error(errorMessage);
      },
    });
  }

  private load(seriesId: string): void {
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.editing.set(false);
    this.loadSubscription = this.groupsService.getSeriesDetail(seriesId).subscribe({
      next: (series) => {
        this.loading.set(false);
        this.series.set(series);
      },
      error: () => {
        this.loading.set(false);
        this.series.set(null);
        this.error.set('Failed to load this series from Stash.');
      },
    });
  }

  // Hover / hold preview on each part's thumbnail (one loader per scene).
  protected previewLoader(scene: SeriesScene): ScenePreviewLoader {
    let loader = this.previewLoaders.get(scene.id);
    if (!loader) {
      loader = () => this.previewService.local(scene.id, scene.duration);
      this.previewLoaders.set(scene.id, loader);
    }

    return loader;
  }

  protected watchedPercent(sceneId: string): number | null {
    return this.watchProgress.percentFor(sceneId);
  }
}
