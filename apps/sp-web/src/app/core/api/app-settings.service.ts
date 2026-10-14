import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AppSettings, UpdateAppSettingsPayload } from './app-settings.types';

@Injectable({
  providedIn: 'root',
})
export class AppSettingsService {
  private readonly http = inject(HttpClient);

  getPreferences(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/settings/preferences');
  }

  updatePreferences(payload: UpdateAppSettingsPayload): Observable<AppSettings> {
    return this.http.patch<AppSettings>('/api/settings/preferences', payload);
  }
}
