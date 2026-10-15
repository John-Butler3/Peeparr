import { Directive, Input, computed, inject, signal } from '@angular/core';
import { Params, Router } from '@angular/router';
import { NavigationHistoryService } from '../../core/navigation/navigation-history.service';

/**
 * A "Back to ..." link: goes back to the previous screen in the app (where
 * you were scrolled) when there is one, otherwise to the given page. Use
 * instead of routerLink -- a routerLink would navigate as well.
 */
@Directive({
  selector: 'a[appBackLink]',
  host: {
    '[attr.href]': 'href()',
    '(click)': 'onClick($event)',
  },
})
export class BackLinkDirective {
  private readonly router = inject(Router);
  private readonly navigationHistory = inject(NavigationHistoryService);

  private readonly target = signal<string | readonly unknown[]>('/');
  private readonly queryParams = signal<Params | null>(null);

  // Decorator inputs (not input()) so tests compiled just-in-time see them.
  /** Where to go with no in-app history, as router commands or a URL. */
  @Input({ required: true }) set appBackLink(value: string | readonly unknown[]) {
    this.target.set(value);
  }

  @Input() set backQueryParams(value: Params | null) {
    this.queryParams.set(value);
  }

  protected readonly href = computed(() => {
    const target = this.target();
    const commands = typeof target === 'string' ? [target] : [...target];
    return this.router.serializeUrl(
      this.router.createUrlTree(commands, { queryParams: this.queryParams() ?? undefined }),
    );
  });

  protected onClick(event: MouseEvent): void {
    // New tab / window: let the browser open the link.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (!this.navigationHistory.back()) {
      void this.router.navigateByUrl(this.href());
    }
  }
}
