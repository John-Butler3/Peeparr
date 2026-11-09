import { Routes } from '@angular/router';
import { fadeOutUnderMovingVideoGuard } from './core/guards/moving-video.guard';
import {
  bootstrapOnlyWhenRequiredGuard,
  loginOnlyWhenLoggedOutGuard,
  requireAuthenticatedGuard,
} from './core/guards/auth-route.guard';
import {
  requireSetupCompleteGuard,
  setupOnlyWhenIncompleteGuard,
} from './core/guards/setup-route.guard';
import { AppShellLayoutComponent } from './layouts/app-shell-layout/app-shell-layout.component';
import { BootstrapPageComponent } from './features/auth/bootstrap-page.component';
import { LoginPageComponent } from './features/auth/login-page.component';

export const routes: Routes = [
  {
    path: 'bootstrap',
    component: BootstrapPageComponent,
    canActivate: [bootstrapOnlyWhenRequiredGuard],
  },
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [loginOnlyWhenLoggedOutGuard],
  },
  {
    path: 'setup',
    loadComponent: () =>
      import('./features/setup/setup-page.component').then((m) => m.SetupPageComponent),
    canActivate: [requireAuthenticatedGuard, setupOnlyWhenIncompleteGuard],
  },
  {
    path: '',
    component: AppShellLayoutComponent,
    canActivate: [requireAuthenticatedGuard, requireSetupCompleteGuard],
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('./pages/home/home-page.component').then((module) => module.HomePageComponent),
      },
      {
        path: 'scene/:stashId',
        loadComponent: () =>
          import('./pages/scene/scene-page.component').then((m) => m.ScenePageComponent),
        canDeactivate: [fadeOutUnderMovingVideoGuard],
      },
      {
        path: 'scenes',
        loadComponent: () =>
          import('./pages/scenes/scenes-page.component').then((m) => m.ScenesPageComponent),
      },
      {
        path: 'search',
        loadComponent: () =>
          import('./pages/search/search-page.component').then((m) => m.SearchPageComponent),
      },
      {
        path: 'acquisition',
        loadComponent: () =>
          import('./pages/acquisition/acquisition-page.component').then(
            (m) => m.AcquisitionPageComponent,
          ),
      },
      {
        path: 'upcoming',
        loadComponent: () =>
          import('./pages/upcoming/upcoming-page.component').then((m) => m.UpcomingPageComponent),
      },
      {
        path: 'library',
        loadComponent: () =>
          import('./pages/library/library-page.component').then((m) => m.LibraryPageComponent),
      },
      {
        path: 'galleries',
        loadComponent: () =>
          import('./pages/galleries/galleries-page.component').then(
            (m) => m.GalleriesPageComponent,
          ),
      },
      {
        path: 'galleries/:galleryId',
        loadComponent: () =>
          import('./pages/gallery/gallery-page.component').then((m) => m.GalleryPageComponent),
      },
      {
        path: 'library/scene/:sceneId',
        canDeactivate: [fadeOutUnderMovingVideoGuard],
        loadComponent: () =>
          import('./pages/local-scene/local-scene-page.component').then(
            (module) => module.LocalScenePageComponent,
          ),
      },
      {
        path: 'series',
        loadComponent: () =>
          import('./pages/series/series-page.component').then(
            (module) => module.SeriesPageComponent,
          ),
      },
      {
        path: 'series/:seriesId',
        loadComponent: () =>
          import('./pages/series-detail/series-detail-page.component').then(
            (module) => module.SeriesDetailPageComponent,
          ),
      },
      {
        path: 'performers',
        loadComponent: () =>
          import('./pages/performers/performers-page.component').then(
            (m) => m.PerformersPageComponent,
          ),
      },
      {
        path: 'studios',
        loadComponent: () =>
          import('./pages/studios/studios-page.component').then((m) => m.StudiosPageComponent),
      },
      {
        path: 'performer/:performerId',
        loadComponent: () =>
          import('./pages/performer/performer-page.component').then(
            (m) => m.PerformerPageComponent,
          ),
      },
      {
        path: 'studio/:studioId',
        loadComponent: () =>
          import('./pages/studio/studio-page.component').then((m) => m.StudioPageComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/settings/settings-page.component').then((m) => m.SettingsPageComponent),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/settings/settings-overview-page.component').then(
                (m) => m.SettingsOverviewPageComponent,
              ),
          },
          {
            path: 'integrations',
            loadComponent: () =>
              import('./pages/settings/settings-integrations-page.component').then(
                (m) => m.SettingsIntegrationsPageComponent,
              ),
          },
          {
            path: 'indexing',
            loadComponent: () =>
              import('./pages/settings/indexing-settings-page.component').then(
                (m) => m.IndexingSettingsPageComponent,
              ),
          },
          {
            path: 'content',
            loadComponent: () =>
              import('./pages/settings/settings-content-page.component').then(
                (m) => m.SettingsContentPageComponent,
              ),
          },
          {
            path: 'purge',
            loadComponent: () =>
              import('./pages/settings/purge-settings-page.component').then(
                (m) => m.PurgeSettingsPageComponent,
              ),
          },
          {
            path: 'account',
            loadComponent: () =>
              import('./pages/settings/settings-account-page.component').then(
                (m) => m.SettingsAccountPageComponent,
              ),
          },
          {
            path: 'about',
            loadComponent: () =>
              import('./pages/settings/settings-about-page.component').then(
                (m) => m.SettingsAboutPageComponent,
              ),
          },
        ],
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'home',
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
