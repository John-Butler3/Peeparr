import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** What to have Stash scan for: new videos, or new images for galleries. */
export type StashScanTarget = 'library' | 'galleries';

export interface StashScanStarted {
  target: StashScanTarget;
  /** Stash's id for the queued job. */
  jobId: string;
  /** The library folders being scanned; empty means all of them. */
  paths: string[];
}

@Injectable({
  providedIn: 'root',
})
export class StashScanService {
  private readonly http = inject(HttpClient);

  /** Queues a scan in Stash; it returns as soon as Stash has taken the job. */
  start(target: StashScanTarget): Observable<StashScanStarted> {
    return this.http.post<StashScanStarted>('/api/stash/scan', { target });
  }
}
