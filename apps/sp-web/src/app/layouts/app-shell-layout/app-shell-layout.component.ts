import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { finalize, merge, of, switchMap, timer } from 'rxjs';
import { catchError, filter } from 'rxjs/operators';
import { AuthService } from '../../core/api/auth.service';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { summarizeRuntimeDegradedState } from '../../core/api/runtime-health.types';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { summarizeDegradedSetupState } from '../../core/api/setup.types';
import { ThemeService } from '../../core/theme/theme.service';
import { BrandMarkComponent } from '../../shared/brand-mark/brand-mark.component';
import { AppSplashComponent } from '../../shared/app-splash/app-splash.component';
import { PageTransitionDirective } from './page-transition.directive';

interface ShellDegradedState {
  kind: 'setup' | 'runtime';
  eyebrow: string;
  message: string;
}

interface ShellNavItem {
  label: string;
  route: string;
  icon: string;
  exact: boolean;
  activePrefixes?: readonly string[];
}

const HOME_NAV_ITEM: ShellNavItem = {
  label: 'Home',
  route: '/home',
  icon: 'pi pi-home',
  exact: true,
};

const SCENES_NAV_ITEM: ShellNavItem = {
  label: 'Scenes',
  route: '/scenes',
  icon: 'pi pi-video',
  exact: false,
  activePrefixes: ['/scenes', '/scene/'],
};

const ACQUISITION_NAV_ITEM: ShellNavItem = {
  label: 'Acquisition',
  route: '/acquisition',
  icon: 'pi pi-inbox',
  exact: true,
};

const UPCOMING_NAV_ITEM: ShellNavItem = {
  label: 'Upcoming',
  route: '/upcoming',
  icon: 'pi pi-calendar',
  exact: true,
};

const LIBRARY_NAV_ITEM: ShellNavItem = {
  label: 'Library',
  route: '/library',
  icon: 'pi pi-folder-open',
  exact: false,
  activePrefixes: ['/library'],
};

const GALLERIES_NAV_ITEM: ShellNavItem = {
  label: 'Galleries',
  route: '/galleries',
  icon: 'pi pi-images',
  exact: false,
  activePrefixes: ['/galleries'],
};

const SERIES_NAV_ITEM: ShellNavItem = {
  label: 'Series',
  route: '/series',
  icon: 'pi pi-list',
  exact: false,
  activePrefixes: ['/series'],
};

const PERFORMERS_NAV_ITEM: ShellNavItem = {
  label: 'Performers',
  route: '/performers',
  icon: 'pi pi-users',
  exact: false,
  activePrefixes: ['/performers', '/performer/'],
};

const STUDIOS_NAV_ITEM: ShellNavItem = {
  label: 'Studios',
  route: '/studios',
  icon: 'pi pi-building',
  exact: false,
  activePrefixes: ['/studios', '/studio/'],
};

const SETTINGS_NAV_ITEM: ShellNavItem = {
  label: 'Settings',
  route: '/settings',
  icon: 'pi pi-cog',
  exact: false,
};

const DESKTOP_NAV_ITEMS: readonly ShellNavItem[] = [
  HOME_NAV_ITEM,
  SCENES_NAV_ITEM,
  ACQUISITION_NAV_ITEM,
  UPCOMING_NAV_ITEM,
  LIBRARY_NAV_ITEM,
  SERIES_NAV_ITEM,
  GALLERIES_NAV_ITEM,
  PERFORMERS_NAV_ITEM,
  STUDIOS_NAV_ITEM,
  SETTINGS_NAV_ITEM,
];

const MOBILE_PRIMARY_NAV_ITEMS: readonly ShellNavItem[] = [
  HOME_NAV_ITEM,
  SCENES_NAV_ITEM,
  ACQUISITION_NAV_ITEM,
  LIBRARY_NAV_ITEM,
];

const MOBILE_SECONDARY_NAV_ITEMS: readonly ShellNavItem[] = [
  UPCOMING_NAV_ITEM,
  SERIES_NAV_ITEM,
  GALLERIES_NAV_ITEM,
  PERFORMERS_NAV_ITEM,
  STUDIOS_NAV_ITEM,
  SETTINGS_NAV_ITEM,
];

@Component({
  selector: 'app-shell-layout',
  imports: [PageTransitionDirective, FormsModule, RouterLink, RouterOutlet, BrandMarkComponent, AppSplashComponent],
  templateUrl: './app-shell-layout.component.html',
  styleUrl: './app-shell-layout.component.scss',
})
export class AppShellLayoutComponent implements OnInit, OnDestroy {
  private static readonly SETUP_STATUS_POLL_INTERVAL_MS = 30_000;
  private static readonly PHONE_SHELL_MEDIA_QUERY = '(max-width: 720px)';
  // Like YouTube: the full guide on wide screens, the mini guide below that.
  private static readonly WIDE_GUIDE_MEDIA_QUERY = '(min-width: 1312px)';
  // Watch pages: on phones the player takes the top edge and the masthead
  // steps aside, as in the YouTube app.
  private static readonly IMMERSIVE_PREFIXES = ['/scene/', '/library/scene/'];
  // How far you scroll before the phone masthead hides/reappears.
  /** Scrolling down this far (in one go) hides the phone's bars... */
  private static readonly BARS_HIDE_AFTER_PX = 24;
  /** ...and scrolling back up this far shows them again. */
  private static readonly BARS_SHOW_AFTER_PX = 16;
  /** Near the top of the page the bars always show. */
  private static readonly BARS_TOP_ZONE_PX = 56;
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly setupService = inject(SetupService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly notifications = inject(AppNotificationsService);
  private readonly themeService = inject(ThemeService);
  private lastScrollY = 0;
  // Where the current run of scrolling in one direction started.
  private scrollRunStartY = 0;
  private scrollDirection: 1 | -1 | 0 = 0;
  private readonly phoneShellMediaQuery = this.createPhoneShellMediaQuery();
  private readonly phoneShellMediaChangeHandler = (event: MediaQueryListEvent) => {
    this.mobileShell.set(event.matches);
    if (!event.matches) {
      this.moreMenuOpen.set(false);
    }
  };

  protected readonly desktopNavItems = DESKTOP_NAV_ITEMS;
  protected readonly mobilePrimaryNavItems = MOBILE_PRIMARY_NAV_ITEMS;
  protected readonly mobileSecondaryNavItems = MOBILE_SECONDARY_NAV_ITEMS;
  protected readonly collapsed = signal(!this.matchesMedia(AppShellLayoutComponent.WIDE_GUIDE_MEDIA_QUERY));
  protected readonly accountMenuOpen = signal(false);
  protected readonly mastheadHidden = signal(false);
  // The bottom bar hides with the masthead; the miniplayer (outside the
  // shell) follows it down via this root class.
  private readonly barsHiddenClass = effect(() => {
    document.documentElement.classList.toggle('shell-bars-hidden', this.mastheadHidden());
  });
  protected readonly searchQuery = signal('');
  protected readonly theme = this.themeService.theme;
  protected readonly mobileShell = signal(this.phoneShellMediaQuery?.matches ?? false);
  protected readonly moreMenuOpen = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly currentUrl = signal(this.router.url);
  protected readonly authStatus = this.authService.status;
  protected readonly runtimeHealth = this.runtimeHealthService.status;
  protected readonly degradedState = computed<ShellDegradedState | null>(() => {
    const setupState = summarizeDegradedSetupState(this.setupStatusStore.status());
    if (setupState) {
      return {
        kind: 'setup',
        eyebrow: 'Repair needed',
        message: setupState.message,
      };
    }

    const runtimeState = summarizeRuntimeDegradedState(
      this.runtimeHealth(),
      this.setupStatusStore.status()?.catalogProvider ?? null,
    );
    if (!runtimeState) {
      return null;
    }

    return {
      kind: 'runtime',
      eyebrow: 'Runtime outage',
      message: runtimeState.message,
    };
  });
  protected readonly immersive = computed(
    () =>
      this.mobileShell() &&
      AppShellLayoutComponent.IMMERSIVE_PREFIXES.some((prefix) =>
        this.currentUrl().startsWith(prefix),
      ),
  );
  protected readonly userInitial = computed(
    () => this.authStatus()?.username?.trim().charAt(0).toUpperCase() || '?',
  );
  protected readonly moreNavActive = computed(() => {
    const currentUrl = this.currentUrl();
    return this.mobileSecondaryNavItems.some((item) => this.matchesNavItem(item, currentUrl));
  });
  /** Which bottom-bar item the glass capsule sits behind (-1: none). */
  protected readonly mobileActiveIndex = computed(() => {
    const currentUrl = this.currentUrl();
    const index = this.mobilePrimaryNavItems.findIndex((item) => this.matchesNavItem(item, currentUrl));
    if (index >= 0) {
      return index;
    }
    return this.moreMenuOpen() || this.moreNavActive() ? this.mobilePrimaryNavItems.length : -1;
  });

  ngOnInit(): void {
    this.runtimeHealthService.ensureStarted();
    this.currentUrl.set(this.normalizeUrl(this.router.url));

    if (this.phoneShellMediaQuery) {
      this.mobileShell.set(this.phoneShellMediaQuery.matches);
      this.phoneShellMediaQuery.addEventListener('change', this.phoneShellMediaChangeHandler);
    }

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl.set(this.normalizeUrl(event.urlAfterRedirects));
        this.moreMenuOpen.set(false);
        this.accountMenuOpen.set(false);
        this.mastheadHidden.set(false);
      });

    merge(
      of(null),
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      ),
      timer(
        AppShellLayoutComponent.SETUP_STATUS_POLL_INTERVAL_MS,
        AppShellLayoutComponent.SETUP_STATUS_POLL_INTERVAL_MS,
      ),
    )
      .pipe(
        switchMap(() => this.setupService.getStatus().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((setupStatus) => {
        if (!setupStatus) {
          return;
        }

        this.setupStatusStore.sync(setupStatus);
      });
  }

  ngOnDestroy(): void {
    document.documentElement.classList.remove('shell-bars-hidden');
    this.phoneShellMediaQuery?.removeEventListener('change', this.phoneShellMediaChangeHandler);
    this.runtimeHealthService.stop();
  }

  // Phone masthead and bottom bar: slide away after a steady scroll down,
  // back after a little scroll up. Small wobbles and the bounce past either
  // end of the page (iOS) don't count, so the bars don't flicker.
  @HostListener('window:scroll')
  protected onWindowScroll(): void {
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const scrollY = Math.min(Math.max(0, window.scrollY), maxY);
    if (!this.mobileShell() || scrollY <= AppShellLayoutComponent.BARS_TOP_ZONE_PX) {
      this.lastScrollY = scrollY;
      this.scrollRunStartY = scrollY;
      this.scrollDirection = 0;
      this.mastheadHidden.set(false);
      return;
    }

    const direction = Math.sign(scrollY - this.lastScrollY) as 1 | -1 | 0;
    if (direction === 0) {
      return;
    }
    if (direction !== this.scrollDirection) {
      this.scrollDirection = direction;
      this.scrollRunStartY = this.lastScrollY;
    }
    this.lastScrollY = scrollY;

    const travelled = Math.abs(scrollY - this.scrollRunStartY);
    if (direction > 0 && travelled >= AppShellLayoutComponent.BARS_HIDE_AFTER_PX) {
      this.mastheadHidden.set(true);
    } else if (direction < 0 && travelled >= AppShellLayoutComponent.BARS_SHOW_AFTER_PX) {
      this.mastheadHidden.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.accountMenuOpen.set(false);
    this.moreMenuOpen.set(false);
  }

  @ViewChild('searchFocusProxy') private searchFocusProxy?: ElementRef<HTMLInputElement>;

  // Search icon (phones): go straight into typing with the keyboard up.
  protected startSearchTyping(): void {
    const searchBox = document.querySelector<HTMLInputElement>('.search-input');
    if (this.router.url.startsWith('/search') && searchBox) {
      searchBox.focus();
      return;
    }

    this.searchFocusProxy?.nativeElement.focus({ preventScroll: true });
  }

  protected submitSearch(): void {
    const query = this.searchQuery().trim();
    void this.router.navigate(['/search'], { queryParams: query ? { q: query } : {} });
  }

  protected toggleAccountMenu(): void {
    this.accountMenuOpen.update((value) => !value);
  }

  protected closeAccountMenu(): void {
    this.accountMenuOpen.set(false);
  }

  protected toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }

  protected toggleMoreMenu(): void {
    this.moreMenuOpen.update((value) => !value);
  }

  protected closeMoreMenu(): void {
    this.moreMenuOpen.set(false);
  }

  protected isNavItemActive(item: ShellNavItem): boolean {
    return this.matchesNavItem(item, this.currentUrl());
  }

  protected logout(): void {
    if (this.loggingOut()) {
      return;
    }

    this.loggingOut.set(true);

    this.authService
      .logout()
      .pipe(
        finalize(() => {
          this.loggingOut.set(false);
        }),
      )
      .subscribe({
        next: () => {
          this.notifications.info('Signed out');
          void this.router.navigateByUrl('/login');
        },
        error: () => {
          this.authService.clearStatus();
          void this.router.navigateByUrl('/login');
        },
      });
  }

  private matchesMedia(query: string): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : true;
  }

  private createPhoneShellMediaQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return null;
    }

    return window.matchMedia(AppShellLayoutComponent.PHONE_SHELL_MEDIA_QUERY);
  }

  private matchesNavItem(item: ShellNavItem, currentUrl: string): boolean {
    const normalizedUrl = this.normalizeUrl(currentUrl);
    if (item.exact) {
      return normalizedUrl === item.route;
    }

    const activePrefixes = item.activePrefixes?.length ? item.activePrefixes : [item.route];
    return activePrefixes.some((prefix) => this.matchesRoutePrefix(normalizedUrl, prefix));
  }

  private matchesRoutePrefix(url: string, prefix: string): boolean {
    if (prefix.endsWith('/')) {
      return url.startsWith(prefix);
    }

    return url === prefix || url.startsWith(`${prefix}/`);
  }

  private normalizeUrl(url: string): string {
    return url.split('?')[0]?.split('#')[0] || '/';
  }
}
