import { Component, Input, inject } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { WatchProgressService } from '../../core/player/watch-progress.service';
import { ScenePreviewService } from '../scene-card/scene-preview.service';
import { ScenePreviewDirective, ScenePreviewLoader } from '../scene-preview/scene-preview.directive';

export interface UpNextItem {
  id: string;
  title: string;
  imageUrl: string | null;
  studio: string | null;
  studioImageUrl?: string | null;
  releaseDate: string | null;
  duration: number | null;
  /**
   * Hover / hold preview: 'local' when id is a Stash scene id, 'catalog'
   * for a catalog scene that's in the library; unset for no preview.
   */
  previewKind?: 'local' | 'catalog' | null;
  /** Highlighted line, e.g. "Part 2 · Series name" for the next part. */
  label?: string | null;
  commands: readonly unknown[];
  queryParams?: Params | null;
}

// YouTube's compact "Up next" rows (thumbnail left, text right).
@Component({
  selector: 'app-up-next-list',
  imports: [RouterLink, ScenePreviewDirective],
  templateUrl: './up-next-list.component.html',
  styleUrl: './up-next-list.component.scss',
})
export class UpNextListComponent {
  @Input() heading = 'Up next';
  @Input() items: readonly UpNextItem[] = [];
  @Input() loading = false;

  private readonly watchProgress = inject(WatchProgressService);
  private readonly previewService = inject(ScenePreviewService);
  private readonly previewLoaders = new Map<string, ScenePreviewLoader>();

  // One loader per scene, so the directive's input stays stable.
  protected previewLoader(item: UpNextItem): ScenePreviewLoader | null {
    const kind = item.previewKind;
    if (!kind) {
      return null;
    }

    const key = `${kind}:${item.id}`;
    let loader = this.previewLoaders.get(key);
    if (!loader) {
      loader =
        kind === 'local'
          ? () => this.previewService.local(item.id, item.duration)
          : () => this.previewService.catalog(item.id);
      this.previewLoaders.set(key, loader);
    }

    return loader;
  }

  protected watchedPercent(sceneId: string): number | null {
    return this.watchProgress.percentFor(sceneId);
  }

  protected durationLabel(seconds: number | null): string | null {
    if (!seconds || seconds <= 0) {
      return null;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(Math.floor(seconds % 60)).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  }
}
