import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DiscoverItem } from './discover.types';

/** Why a scene is on the calendar. */
export interface UpcomingReason {
  kind: 'REQUESTED' | 'PERFORMER' | 'STUDIO';
  id: string | null;
  name: string | null;
}

export interface UpcomingItem extends DiscoverItem {
  releaseDate: string;
  requestable: boolean;
  reasons: UpcomingReason[];
}

export interface UpcomingResponse {
  from: string;
  to: string;
  today: string;
  items: UpcomingItem[];
}

@Injectable({
  providedIn: 'root',
})
export class UpcomingService {
  private readonly http = inject(HttpClient);

  getUpcoming(): Observable<UpcomingResponse> {
    return this.http.get<UpcomingResponse>('/api/upcoming');
  }
}
