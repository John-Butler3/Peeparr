import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  PreloadAllModules,
  RouteReuseStrategy,
  provideRouter,
  withPreloading,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { authRedirectInterceptor } from './core/interceptors/auth-redirect.interceptor';
import { KeepAliveRouteStrategy } from './core/navigation/keep-alive-route.strategy';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Scroll position (top on new pages, restored on going back) is handled
    // by ScrollMemoryService, started in App.
    // Pages loaded on demand are fetched in the background after start-up,
    // so going to them never waits for their code.
    provideRouter(routes, withPreloading(PreloadAllModules)),
    // Pages you leave stay alive (asleep), so going back is instant.
    { provide: RouteReuseStrategy, useClass: KeepAliveRouteStrategy },
    provideHttpClient(withInterceptors([authRedirectInterceptor])),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: "[data-theme='dark']",
        },
      },
    }),
    MessageService,
    ConfirmationService,
  ],
};
