import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface NetworkSettings {
  /** Saved choice: null (no proxy), a hop count ("1"), or proxy addresses. */
  trustProxy: string | null;
  effectiveTrustProxy: string | null;
  lockedByEnvironment: boolean;
  connectedThroughProxy: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class NetworkSettingsService {
  private readonly http = inject(HttpClient);

  get(): Observable<NetworkSettings> {
    return this.http.get<NetworkSettings>('/api/settings/network');
  }

  update(trustProxy: string | null): Observable<NetworkSettings> {
    return this.http.put<NetworkSettings>('/api/settings/network', { trustProxy });
  }
}
