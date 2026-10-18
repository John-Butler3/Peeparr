import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface TpdbWebStatus {
  configured: boolean;
  email: string | null;
  popularCount: number;
  popularPerformerCount: number;
  popularSiteCount: number;
  popularFetchedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  sourcePath: string | null;
  performerSourcePath: string | null;
  siteSourcePath: string | null;
}

// The optional ThePornDB website login (for its members-only popular scenes).
@Injectable({
  providedIn: 'root',
})
export class TpdbWebService {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<TpdbWebStatus> {
    return this.http.get<TpdbWebStatus>('/api/tpdb-web');
  }

  save(email: string, password: string | null): Observable<TpdbWebStatus> {
    return this.http.put<TpdbWebStatus>('/api/tpdb-web', {
      email,
      ...(password ? { password } : {}),
    });
  }

  remove(): Observable<void> {
    return this.http.delete<void>('/api/tpdb-web');
  }

  refresh(): Observable<TpdbWebStatus> {
    return this.http.post<TpdbWebStatus>('/api/tpdb-web/refresh', {});
  }
}
