import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AcquisitionLifecycleFilter, AcquisitionScenesResponse } from './acquisition.types';

@Injectable({
  providedIn: 'root',
})
export class AcquisitionService {
  private readonly http = inject(HttpClient);

  getScenesFeed(
    page: number,
    perPage: number,
    lifecycle: AcquisitionLifecycleFilter = 'ANY',
  ): Observable<AcquisitionScenesResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (lifecycle !== 'ANY') {
      params = params.set('lifecycle', lifecycle);
    }

    return this.http.get<AcquisitionScenesResponse>('/api/acquisition/scenes', {
      params,
    });
  }

  removeSceneRequest(
    stashId: string,
    options?: { deleteFiles?: boolean; addImportExclusion?: boolean },
  ): Observable<{ removed: true; stashId: string; whisparrMovieId: number | null }> {
    let params = new HttpParams();
    if (options?.deleteFiles !== undefined) {
      params = params.set('deleteFiles', String(options.deleteFiles));
    }
    if (options?.addImportExclusion !== undefined) {
      params = params.set(
        'addImportExclusion',
        String(options.addImportExclusion),
      );
    }

    return this.http.delete<{
      removed: true;
      stashId: string;
      whisparrMovieId: number | null;
    }>(`/api/requests/${encodeURIComponent(stashId)}`, { params });
  }
}
