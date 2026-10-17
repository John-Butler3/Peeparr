import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { Params, Router, RouterLink } from '@angular/router';
import { SceneRequestContext, SceneStatus } from '../../core/api/discover.types';
import {
  SceneCardBodyDirective,
  SceneCardMediaFooterDirective,
  SceneCardShellComponent,
  SceneCardShellItem,
  SceneCardShellLink,
  SceneCardTopRightDirective,
} from './scene-card-shell.component';
import { SceneStatusBadgeComponent } from '../scene-status-badge/scene-status-badge.component';
import { Observable } from 'rxjs';
import { ScenePreviewService, ScenePreviewSource } from './scene-preview.service';
import { WatchProgressService } from '../../core/player/watch-progress.service';

export interface SceneCardItem extends SceneCardShellItem {
  id: string;
  releaseDate: string | null;
  duration?: number | null;
  status?: SceneStatus | null;
  /** A Pornhub video, not in the library, that plays streamed. */
  streamable?: boolean;
}

export type SceneCardVariant = 'default' | 'rail';
export type SceneCardTone = 'media' | 'surface';
// 'local': a Stash scene with no catalog match, opened on the library's
// own scene page (/library/scene/:id) rather than the catalog scene page.
export type SceneCardPrimaryLinkMode = 'scene' | 'local' | 'external';
export type SceneCardPlaySize = 'compact' | 'large';
// How the card's id maps to a playable file, for the hover preview:
// 'local' = a Stash scene id, 'catalog' = a catalog id with a Stash copy.
export type SceneCardPreviewKind = 'local' | 'catalog';

export interface SceneCardBadge {
  label: string;
}

@Component({
  selector: 'app-scene-card',
  imports: [
    RouterLink,
    SceneCardShellComponent,
    SceneCardTopRightDirective,
    SceneCardMediaFooterDirective,
    SceneCardBodyDirective,
    SceneStatusBadgeComponent,
  ],
  templateUrl: './scene-card.component.html',
  styleUrl: './scene-card.component.scss',
  host: {
    '[class.scene-card-variant-rail]': "variant === 'rail'",
    '[class.scene-card-variant-default]': "variant !== 'rail'",
    '[class.scene-card-tone-media]': "tone !== 'surface'",
    '[class.scene-card-tone-surface]': "tone === 'surface'",
  },
})
export class SceneCardComponent {
  private readonly router = inject(Router);
  private readonly previewService = inject(ScenePreviewService);
  private readonly watchProgress = inject(WatchProgressService);
  private previewLoaderCache: {
    key: string;
    loader: () => Observable<ScenePreviewSource | null>;
  } | null = null;

  @Input({ required: true }) item!: SceneCardItem;
  @Input() requestable = false;
  @Input() variant: SceneCardVariant = 'default';
  @Input() tone: SceneCardTone = 'media';
  @Input() primaryLinkMode: SceneCardPrimaryLinkMode = 'scene';
  @Input() sceneRouteId: string | null = null;
  @Input() sceneQueryParams: Params | null = null;
  @Input() externalHref: string | null = null;
  @Input() showStudioBadge = true;
  @Input() topBadges: readonly SceneCardBadge[] = [];
  @Input() footerLink: SceneCardShellLink | null = null;
  @Input() footerLinkLabel: string | null = null;
  @Input() footerBadgeLabel: string | null = null;
  @Input() playable = false;
  @Input() playSize: SceneCardPlaySize = 'compact';
  @Input() progressPercent: number | null = null;
  @Input() showMarkWatched = false;
  /** Enables the hover preview for playable cards. */
  @Input() previewKind: SceneCardPreviewKind | null = null;

  @Output() request = new EventEmitter<SceneRequestContext>();
  @Output() play = new EventEmitter<string>();
  @Output() markWatched = new EventEmitter<string>();

  protected shellVariant(): 'default' | 'rail' {
    return this.variant === 'rail' ? 'rail' : 'default';
  }

  protected statusIcon(): SceneStatus | null {
    const status = this.item.status;
    return status && status.state !== 'NOT_REQUESTED' ? status : null;
  }

  protected primaryLink(): SceneCardShellLink {
    if (this.primaryLinkMode === 'external') {
      return {
        kind: 'external',
        href: this.externalHref ?? '',
        ariaLabel: this.item.title,
      };
    }

    if (this.primaryLinkMode === 'local') {
      return {
        kind: 'router',
        commands: ['/library/scene', this.item.id],
        queryParams: this.sceneQueryParams,
        ariaLabel: this.item.title,
      };
    }

    return {
      kind: 'router',
      commands: ['/scene', this.sceneRouteIdValue()],
      queryParams: this.sceneQueryParams,
      ariaLabel: this.item.title,
    };
  }

  protected studioBadgeLink(): SceneCardShellLink | null {
    if (!this.item.studioId) {
      return null;
    }

    return {
      kind: 'router',
      commands: ['/studio', this.item.studioId],
      queryParams: { returnTo: this.router.url },
      ariaLabel: this.item.studio ? `Open studio ${this.item.studio}` : 'Open studio',
    };
  }

  protected footerLinkText(): string | null {
    if (!this.footerLink) {
      return null;
    }

    const label = this.footerLinkLabel?.trim() ?? '';
    return label.length > 0 ? label : null;
  }

  protected footerBadgeText(): string | null {
    const label = this.footerBadgeLabel?.trim() ?? '';
    return label.length > 0 ? label : null;
  }

  protected footerLinkIsExternal(): boolean {
    return this.footerLink?.kind === 'external';
  }

  protected footerLinkRouterCommands(): string | readonly unknown[] | null {
    return this.footerLink?.kind === 'router' ? this.footerLink.commands : null;
  }

  protected footerLinkQueryParams(): Params | null {
    return this.footerLink?.kind === 'router' ? (this.footerLink.queryParams ?? null) : null;
  }

  protected footerExternalHref(): string | null {
    if (this.footerLink?.kind !== 'external') {
      return null;
    }

    const href = this.footerLink.href.trim();
    return href.length > 0 ? href : null;
  }

  // Once requested, the title button keeps its size and place and shows
  // where the scene is instead (not clickable).
  protected titleStatus(): { icon: string; label: string; tone: string } | null {
    if (this.requestable || this.showPlayAction()) {
      return null;
    }

    switch (this.item.status?.state) {
      case 'REQUESTED':
        return { icon: 'pi pi-clock', label: 'Requested', tone: 'requested' };
      case 'DOWNLOADING':
        return { icon: 'pi pi-arrow-down', label: 'Downloading', tone: 'downloading' };
      case 'IMPORT_PENDING':
        return { icon: 'pi pi-hourglass', label: 'Importing', tone: 'importing' };
      case 'FAILED':
        return { icon: 'pi pi-exclamation-triangle', label: 'Failed', tone: 'failed' };
      default:
        return null;
    }
  }

  protected footerStatus(): SceneStatus | null {
    // Shown by the title button instead.
    if (this.titleStatus()) {
      return null;
    }

    if (
      this.requestable ||
      this.footerLinkText() ||
      this.footerBadgeText() ||
      this.showPlayAction()
    ) {
      return null;
    }

    return this.item.status ?? null;
  }

  // Previewable whenever there's a Stash file behind the card: a library
  // item (no lifecycle status) or a catalog scene that's AVAILABLE.
  private isInLibrary(): boolean {
    const status = this.item.status;
    return !status || status.state === 'AVAILABLE';
  }

  protected showPlayAction(): boolean {
    if (!this.playable || this.requestable) {
      return false;
    }

    const status = this.item.status;
    if (!status) {
      // No lifecycle status is tracked for this item (e.g. Library cards) — its
      // presence in the list already means it's a real Stash-backed scene.
      return true;
    }

    return status.state === 'AVAILABLE';
  }

  protected hasSecondaryFooterAction(): boolean {
    return this.requestable || !!this.footerLinkText() || !!this.footerBadgeText();
  }

  // YouTube cards: Play is always the compact pill under the
  // thumbnail; playSize is kept for API compatibility.
  protected showCompactPlayAction(): boolean {
    return this.showPlayAction();
  }

  // Same function instance while the card shows the same scene, so the
  // shell's input doesn't churn on every change detection.
  protected previewLoader(): (() => Observable<ScenePreviewSource | null>) | null {
    const kind = this.previewKind;
    if (!kind || !this.isInLibrary()) {
      return null;
    }

    const id = this.item.id;
    const duration = this.item.duration ?? null;
    const key = `${kind}:${id}:${duration}`;
    if (this.previewLoaderCache?.key !== key) {
      this.previewLoaderCache = {
        key,
        loader: () =>
          kind === 'local'
            ? this.previewService.local(id, duration)
            : this.previewService.catalog(id),
      };
    }

    return this.previewLoaderCache.loader;
  }

  // Red "watched" line: the page's own value (Continue Watching) or the
  // scene's watch history.
  protected watchedPercent(): number | null {
    return this.progressPercent ?? this.watchProgress.percentFor(this.item.id);
  }

  protected durationLabel(): string | null {
    const seconds = this.item.duration ?? 0;
    if (!seconds || seconds <= 0) {
      return null;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(Math.floor(seconds % 60)).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  }

  protected studioInitial(): string {
    return this.item.studio?.trim().charAt(0).toUpperCase() || '';
  }

  protected titleRouterCommands(): string | readonly unknown[] | null {
    const link = this.primaryLink();
    return link.kind === 'router' ? link.commands : null;
  }

  protected titleQueryParams(): Params | null {
    const link = this.primaryLink();
    return link.kind === 'router' ? (link.queryParams ?? null) : null;
  }

  protected titleExternalHref(): string | null {
    const link = this.primaryLink();
    return link.kind === 'external' && link.href ? link.href : null;
  }

  protected studioLinkCommands(): string | readonly unknown[] | null {
    const link = this.studioBadgeLink();
    return link?.kind === 'router' ? link.commands : null;
  }

  protected studioLinkQueryParams(): Params | null {
    const link = this.studioBadgeLink();
    return link?.kind === 'router' ? (link.queryParams ?? null) : null;
  }

  protected requestScene(event: MouseEvent): void {
    event.stopPropagation();
    this.request.emit({
      id: this.item.id,
      title: this.item.title,
      imageUrl: this.item.imageUrl,
    });
  }

  protected playScene(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.play.emit(this.item.id);
  }

  protected markSceneWatched(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.markWatched.emit(this.item.id);
  }

  private sceneRouteIdValue(): string {
    const sceneRouteId = this.sceneRouteId?.trim() ?? '';
    return sceneRouteId.length > 0 ? sceneRouteId : this.item.id;
  }
}
