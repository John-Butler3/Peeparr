import { Routes } from '@angular/router';
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
import { SetupPageComponent } from './features/setup/setup-page.component';
import { AcquisitionPageComponent } from './pages/acquisition/acquisition-page.component';
import { GalleriesPageComponent } from './pages/galleries/galleries-page.component';
import { GalleryPageComponent } from './pages/gallery/gallery-page.component';
import { LibraryPageComponent } from './pages/library/library-page.component';
import { ScenesPageComponent } from './pages/scenes/scenes-page.component';
import { ScenePageComponent } from './pages/scene/scene-page.component';
import { IndexingSettingsPageComponent } from './pages/settings/indexing-settings-page.component';
import { SettingsAboutPageComponent } from './pages/settings/settings-about-page.component';
import { SettingsAccountPageComponent } from './pages/settings/settings-account-page.component';
import { SettingsContentPageComponent } from './pages/settings/settings-content-page.component';
import { SettingsIntegrationsPageComponent } from './pages/settings/settings-integrations-page.component';
import { SettingsOverviewPageComponent } from './pages/settings/settings-overview-page.component';
import { SettingsPageComponent } from './pages/settings/settings-page.component';
import { PerformersPageComponent } from './pages/performers/performers-page.component';
import { PerformerPageComponent } from './pages/performer/performer-page.component';
import { StudiosPageComponent } from './pages/studios/studios-page.component';
import { StudioPageComponent } from './pages/studio/studio-page.component';
import { SearchPageComponent } from './pages/search/search-page.component';

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
    component: SetupPageComponent,
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
        component: ScenePageComponent,
      },
      {
        path: 'scenes',
        component: ScenesPageComponent,
      },
      {
        path: 'search',
        component: SearchPageComponent,
      },
      {
        path: 'acquisition',
        component: AcquisitionPageComponent,
      },
      {
        path: 'library',
        component: LibraryPageComponent,
      },
      {
        path: 'galleries',
        component: GalleriesPageComponent,
      },
      {
        path: 'galleries/:galleryId',
        component: GalleryPageComponent,
      },
      {
        path: 'library/scene/:sceneId',
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
        component: PerformersPageComponent,
      },
      {
        path: 'studios',
        component: StudiosPageComponent,
      },
      {
        path: 'performer/:performerId',
        component: PerformerPageComponent,
      },
      {
        path: 'studio/:studioId',
        component: StudioPageComponent,
      },
      {
        path: 'settings',
        component: SettingsPageComponent,
        children: [
          {
            path: '',
            component: SettingsOverviewPageComponent,
          },
          {
            path: 'integrations',
            component: SettingsIntegrationsPageComponent,
          },
          {
            path: 'indexing',
            component: IndexingSettingsPageComponent,
          },
          {
            path: 'content',
            component: SettingsContentPageComponent,
          },
          {
            path: 'account',
            component: SettingsAccountPageComponent,
          },
          {
            path: 'about',
            component: SettingsAboutPageComponent,
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
