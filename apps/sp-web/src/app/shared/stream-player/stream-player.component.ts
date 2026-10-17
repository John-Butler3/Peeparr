import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { PageFadeService, onShowingPage } from '../../core/navigation/page-fade.service';
import { EmbedPlayerService } from '../../core/player/embed-player.service';
import { PlayerDetails, PlayerService } from '../../core/player/player.service';

/**
 * The scene page's player for a scene streamed from Pornhub: Pornhub's
 * embed player (EmbedPlayerService: one player, laid over this spot), there
 * as the page opens -- Play is pressed in it, once (it can't be started from
 * outside). Like the scene page's own player: leaving the page once it's
 * started carries it on in the miniplayer, and coming back takes it back;
 * the strip along its top edge is the handle to swipe it down into the
 * miniplayer, the page you came from revealed behind. Play/pause and
 * seeking are in Pornhub's player.
 *
 * With another streamed scene in the miniplayer (there's one embed), it's a
 * poster with Play until you choose this one.
 */
@Component({
  selector: 'app-stream-player',
  templateUrl: './stream-player.component.html',
  styleUrls: ['../inline-player/inline-player.component.scss', './stream-player.component.scss'],
})
export class StreamPlayerComponent implements OnInit, OnChanges, OnDestroy {
  /** How far down a swipe must go to go to the miniplayer... */
  static readonly MINIMIZE_DRAG_PX = 110;
  /** ...or a flick this fast (px/ms) and this far. */
  static readonly MINIMIZE_FLICK_SPEED = 0.5;
  static readonly MINIMIZE_FLICK_PX = 40;
  /** This long after it starts, the page you came from is readied behind. */
  static readonly PREPARE_BEHIND_MS = 1500;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly embedPlayer = inject(EmbedPlayerService);
  private readonly playerService = inject(PlayerService);
  private readonly pageFade = inject(PageFadeService);

  @Input({ required: true }) title = '';
  @Input() posterUrl: string | null = null;
  @Input() durationSeconds: number | null = null;
  @Input({ required: true }) embedUrl = '';
  @Input() details: PlayerDetails | null = null;
  @Input() set autoplay(value: boolean) {
    if (value && this.status() === 'idle') {
      // After the first render, once the spot exists.
      queueMicrotask(() => this.start());
    }
  }

  /** Swiped down: leave the page, the stream carrying on in the miniplayer. */
  @Output() minimize = new EventEmitter<void>();

  protected readonly status = signal<'idle' | 'ready'>('idle');

  private spot: HTMLElement | null = null;
  private asleep = false;
  private handedOff = false;
  private leavingRect: DOMRect | null = null;
  private drag: {
    x: number;
    y: number;
    down: boolean | null;
    lifted: boolean;
    dy: number;
    time: number;
    speed: number;
    from: DOMRect | null;
  } | null = null;
  private dragListeners: AbortController | null = null;
  private prepareTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly navigationWatch = inject(Router).events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      this.leavingRect = this.embedPlayer.isOwner(this) ? this.embedPlayer.rect() : null;
    } else if (event instanceof NavigationEnd) {
      if (!onShowingPage(this.host) && !this.asleep) {
        this.sleep();
      } else if (onShowingPage(this.host) && this.asleep) {
        this.wake();
      }
    }
  });

  // The spot appears once started: the embed is laid over it.
  @ViewChild('spot') private set spotRef(ref: ElementRef<HTMLElement> | undefined) {
    this.spot = ref?.nativeElement ?? null;
    if (this.spot && !this.asleep) {
      this.attach();
    }
  }

  ngOnInit(): void {
    if (!this.embedPlayer.busyElsewhere(this.embedUrl)) {
      this.status.set('ready');
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Another scene on the same page: its embed instead.
    const embed = changes['embedUrl'];
    if (!embed || embed.firstChange || this.asleep) {
      return;
    }
    this.embedPlayer.release(this);
    if (this.embedPlayer.busyElsewhere(this.embedUrl)) {
      this.status.set('idle');
    } else if (this.spot) {
      this.attach();
    } else {
      this.status.set('ready');
    }
  }

  ngOnDestroy(): void {
    if (!this.handOffIfPlaying()) {
      this.embedPlayer.release(this);
    }
    this.navigationWatch.unsubscribe();
    this.dragListeners?.abort();
    if (this.prepareTimer) {
      clearTimeout(this.prepareTimer);
    }
  }

  /** The page's own Play button. */
  play(): void {
    this.start();
  }

  protected start(): void {
    if (this.status() === 'ready' || !this.embedUrl) {
      return;
    }
    // One video at a time: an open miniplayer gives way.
    this.playerService.close();
    this.status.set('ready');
  }

  /** Play pressed in the embed: one video at a time, so the miniplayer gives way. */
  private onStarted(): void {
    if (this.embedPlayer.isOwner(this)) {
      this.playerService.close();
      this.readyPageBehind();
    }
  }

  /**
   * Readies the page you came from behind this one (unseen), a moment after
   * it starts, so a swipe down needn't wait for it to be put back.
   */
  private readyPageBehind(): void {
    if (this.prepareTimer) {
      clearTimeout(this.prepareTimer);
    }
    this.prepareTimer = setTimeout(() => {
      this.prepareTimer = null;
      if (this.embedPlayer.isOwner(this) && onShowingPage(this.host) && !this.drag) {
        this.pageFade.prepareBehind();
      }
    }, StreamPlayerComponent.PREPARE_BEHIND_MS);
  }

  protected durationLabel(): string | null {
    const seconds = this.durationSeconds ?? 0;
    if (seconds <= 0) {
      return null;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(Math.floor(seconds % 60)).padStart(2, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
      : `${minutes}:${rest}`;
  }

  private attach(): void {
    if (!this.spot) {
      return;
    }
    const carriedOn = this.embedPlayer.attach(
      this,
      this.spot,
      this.embedUrl,
      'page',
      {
        start: (event) => this.onGrabStart(event),
        started: () => this.onStarted(),
      },
      this.posterUrl,
    );
    if (carriedOn) {
      // Taken back from the miniplayer (or a player this page had before).
      this.playerService.close();
      this.readyPageBehind();
    }
  }

  /** Leaving once it's started: it carries on in the miniplayer. */
  private handOffIfPlaying(): boolean {
    if (
      !this.embedPlayer.isOwner(this) ||
      !this.embedPlayer.has(this.embedUrl) ||
      !this.embedPlayer.wasStarted()
    ) {
      return false;
    }
    this.embedPlayer.park(this, this.leavingRect ?? this.embedPlayer.rect());
    this.playerService.handOff({
      title: this.title,
      imageUrl: this.posterUrl,
      source: {
        streamUrl: '',
        stashSceneId: `embed:${this.embedUrl}`,
        resumeSeconds: 0,
        duration: this.durationSeconds,
        embedUrl: this.embedUrl,
      },
      details: this.details,
    });
    return true;
  }

  private sleep(): void {
    this.asleep = true;
    this.handedOff = this.handOffIfPlaying();
    if (!this.handedOff) {
      this.embedPlayer.release(this);
      this.status.set('idle');
    }
  }

  private wake(): void {
    this.asleep = false;
    const takeBack = this.handedOff && !!this.spot && this.embedPlayer.has(this.embedUrl);
    this.handedOff = false;
    if (takeBack) {
      // Still in the miniplayer: it comes back (flying up) here.
      this.attach();
      return;
    }
    if (!this.embedPlayer.isOwner(this)) {
      // Loaded again (or a poster, with another in the miniplayer). Asleep,
      // the page wasn't redrawn: its spot may still be there to load into.
      if (this.embedPlayer.busyElsewhere(this.embedUrl)) {
        this.status.set('idle');
      } else if (this.spot) {
        this.status.set('ready');
        this.attach();
      } else {
        this.status.set('ready');
      }
    }
  }

  // The grab strip along the player's top edge: swipe down to the miniplayer.
  private onGrabStart(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1) {
      return;
    }
    this.drag = {
      x: touch.clientX,
      y: touch.clientY,
      down: null,
      lifted: false,
      dy: 0,
      time: event.timeStamp,
      speed: 0,
      from: null,
    };
    this.dragListeners?.abort();
    this.dragListeners = new AbortController();
    const signal = this.dragListeners.signal;
    document.addEventListener('touchmove', (e) => this.onGrabMove(e), { passive: false, signal });
    document.addEventListener('touchend', () => this.onGrabEnd(), { signal });
    document.addEventListener('touchcancel', () => this.onGrabEnd(), { signal });
  }

  private onGrabMove(event: TouchEvent): void {
    const drag = this.drag;
    const touch = event.touches[0];
    if (!drag || !touch) {
      return;
    }
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (drag.down === null && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
      drag.down = dy > 0 && dy > Math.abs(dx);
    }
    if (!drag.down) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    drag.speed = (dy - drag.dy) / Math.max(1, event.timeStamp - drag.time);
    drag.dy = dy;
    drag.time = event.timeStamp;
    if (!drag.lifted) {
      drag.from = this.embedPlayer.rect();
      drag.lifted = this.embedPlayer.lift(this);
      if (drag.lifted) {
        this.pageFade.revealBehindSoon(() => this.drag === drag);
      }
    }
    if (!drag.lifted || !drag.from) {
      return;
    }
    // Down with the finger, sliding across and shrinking to the miniplayer's spot.
    const target = document.querySelector('.mini-target')?.getBoundingClientRect();
    if (target && target.top > drag.from.top) {
      this.embedPlayer.moveLiftedTo(target, Math.max(0, dy) / (target.top - drag.from.top));
    }
    this.pageFade.setProgress(dy / (StreamPlayerComponent.MINIMIZE_DRAG_PX * 3));
  }

  private onGrabEnd(): void {
    const drag = this.drag;
    this.drag = null;
    this.dragListeners?.abort();
    this.dragListeners = null;
    if (!drag?.lifted) {
      return;
    }
    const minimise =
      drag.dy > StreamPlayerComponent.MINIMIZE_DRAG_PX ||
      (drag.speed > StreamPlayerComponent.MINIMIZE_FLICK_SPEED &&
        drag.dy > StreamPlayerComponent.MINIMIZE_FLICK_PX);
    if (minimise) {
      // Swiped down to the miniplayer: it goes there, started or not.
      this.embedPlayer.markStarted();
      this.minimize.emit();
    } else {
      this.embedPlayer.dropBack();
      this.pageFade.cancel();
    }
  }
}
