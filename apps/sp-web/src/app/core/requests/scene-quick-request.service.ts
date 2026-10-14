import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { AppSettingsService } from '../api/app-settings.service';
import { DiscoverService } from '../api/discover.service';
import { AppNotificationsService } from '../notifications/app-notifications.service';

export interface QuickRequestResult {
  submitted: boolean;
}

/**
 * Submits a scene request immediately using the saved default download
 * profile (Settings > Content), skipping the manual options modal. Resolves
 * `submitted: false` -- never throws -- when no defaults are configured, or
 * the request failed, so callers can fall back to opening the modal.
 */
@Injectable({
  providedIn: 'root',
})
export class SceneQuickRequestService {
  private readonly appSettingsService = inject(AppSettingsService);
  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);

  tryQuickRequest(stashId: string): Observable<QuickRequestResult> {
    return this.appSettingsService.getPreferences().pipe(
      switchMap((settings) => {
        if (!settings.defaultRootFolderPath || !settings.defaultQualityProfileId) {
          return of<QuickRequestResult>({ submitted: false });
        }

        return this.discoverService
          .submitSceneRequest(stashId, {
            monitored: settings.defaultMonitored,
            rootFolderPath: settings.defaultRootFolderPath,
            searchForMovie: settings.defaultSearchForMovie,
            qualityProfileId: settings.defaultQualityProfileId,
            tags: settings.defaultTagIds,
          })
          .pipe(
            map(() => {
              this.notifications.success(
                'Scene request submitted to Whisparr',
                'Track progress on Acquisition.',
              );
              return { submitted: true };
            }),
            catchError(() => of<QuickRequestResult>({ submitted: false })),
          );
      }),
      catchError(() => of<QuickRequestResult>({ submitted: false })),
    );
  }
}
