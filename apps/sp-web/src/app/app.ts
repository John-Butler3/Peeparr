import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Toast } from 'primeng/toast';
import { ThemeToggleComponent } from './shared/theme-toggle/theme-toggle.component';
import { MiniplayerComponent } from './shared/miniplayer/miniplayer.component';
import { dismissBootSplash } from './shared/app-splash/boot-splash';
import { ScrollMemoryService } from './core/navigation/scroll-memory.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ThemeToggleComponent, Toast, ConfirmDialog, MiniplayerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);

  protected readonly isHomeRoute = signal(this.router.url.startsWith('/home'));

  constructor() {
    inject(ScrollMemoryService).start();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.isHomeRoute.set(this.router.url.startsWith('/home'));
      // The first page isn't the app shell (e.g. sign-in, which has its own
      // intro): fade the index.html splash away. The shell takes it over
      // itself when it's what loaded.
      dismissBootSplash();
    });
  }
}
