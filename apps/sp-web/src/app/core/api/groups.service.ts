import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  SceneSeriesMembership,
  SeriesDetail,
  SeriesFeedResponse,
} from './groups.types';

// Series = Stash Groups (see /api/groups). Scene ids are Stash-local.
@Injectable({
  providedIn: 'root',
})
export class GroupsService {
  private readonly http = inject(HttpClient);

  getSeries(page: number, perPage: number, query?: string): Observable<SeriesFeedResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());
    if (query) {
      params = params.set('query', query);
    }

    return this.http.get<SeriesFeedResponse>('/api/groups', { params });
  }

  getSeriesDetail(seriesId: string): Observable<SeriesDetail> {
    return this.http.get<SeriesDetail>(`/api/groups/${encodeURIComponent(seriesId)}`);
  }

  getSeriesForScene(sceneId: string): Observable<SceneSeriesMembership[]> {
    return this.http.get<SceneSeriesMembership[]>(
      `/api/groups/for-scene/${encodeURIComponent(sceneId)}`,
    );
  }

  createSeries(input: { name: string; synopsis?: string; sceneId?: string }): Observable<SeriesDetail> {
    return this.http.post<SeriesDetail>('/api/groups', input);
  }

  updateSeries(seriesId: string, input: { name?: string; synopsis?: string }): Observable<SeriesDetail> {
    return this.http.patch<SeriesDetail>(`/api/groups/${encodeURIComponent(seriesId)}`, input);
  }

  deleteSeries(seriesId: string): Observable<void> {
    return this.http.delete<void>(`/api/groups/${encodeURIComponent(seriesId)}`);
  }

  addScene(seriesId: string, sceneId: string): Observable<SeriesDetail> {
    return this.http.post<SeriesDetail>(`/api/groups/${encodeURIComponent(seriesId)}/scenes`, {
      sceneId,
    });
  }

  removeScene(seriesId: string, sceneId: string): Observable<SeriesDetail> {
    return this.http.delete<SeriesDetail>(
      `/api/groups/${encodeURIComponent(seriesId)}/scenes/${encodeURIComponent(sceneId)}`,
    );
  }

  reorderScenes(seriesId: string, sceneIds: string[]): Observable<SeriesDetail> {
    return this.http.put<SeriesDetail>(
      `/api/groups/${encodeURIComponent(seriesId)}/scenes/order`,
      { sceneIds },
    );
  }
}
