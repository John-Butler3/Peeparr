import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  LibrarySceneSort,
  LibrarySceneDetail,
  LibrarySceneItem,
  LibraryScenesFeedResponse,
  LibrarySearchResponse,
  LibrarySearchScenes,
  LibrarySortDirection,
  LibraryStudioOption,
  LibraryTagMatchMode,
  LibraryTagOption,
} from './library.types';

@Injectable({
  providedIn: 'root',
})
export class LibraryService {
  private readonly http = inject(HttpClient);

  getScenesFeed(
    page: number,
    perPage: number,
    filters?: {
      query?: string;
      sort?: LibrarySceneSort;
      direction?: LibrarySortDirection;
      tagIds?: string[];
      tagMode?: LibraryTagMatchMode;
      studioIds?: string[];
      performerIds?: string[];
      favoritePerformersOnly?: boolean;
      favoriteStudiosOnly?: boolean;
      favoriteTagsOnly?: boolean;
    },
  ): Observable<LibraryScenesFeedResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (filters?.query) {
      params = params.set('query', filters.query);
    }
    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.tagIds && filters.tagIds.length > 0) {
      params = params.set('tagIds', filters.tagIds.join(','));
    }
    if (filters?.tagMode) {
      params = params.set('tagMode', filters.tagMode);
    }
    if (filters?.studioIds && filters.studioIds.length > 0) {
      params = params.set('studioIds', filters.studioIds.join(','));
    }
    if (filters?.performerIds && filters.performerIds.length > 0) {
      params = params.set('performerIds', filters.performerIds.join(','));
    }
    if (filters?.favoritePerformersOnly) {
      params = params.set('favoritePerformersOnly', 'true');
    }
    if (filters?.favoriteStudiosOnly) {
      params = params.set('favoriteStudiosOnly', 'true');
    }
    if (filters?.favoriteTagsOnly) {
      params = params.set('favoriteTagsOnly', 'true');
    }

    return this.http.get<LibraryScenesFeedResponse>('/api/library/scenes', { params });
  }

  getScene(sceneId: string): Observable<LibrarySceneDetail> {
    return this.http.get<LibrarySceneDetail>(`/api/library/scenes/${encodeURIComponent(sceneId)}`);
  }

  /** Other library scenes with all-female performers ("Up next"). */
  /** Library scenes with these performers (catalog ids), for a scene not in the library. */
  getRecommendedForPerformers(
    catalogPerformerIds: readonly string[],
    limit = 20,
  ): Observable<{ items: LibrarySceneItem[] }> {
    return this.http.get<{ items: LibrarySceneItem[] }>('/api/library/recommended', {
      params: new HttpParams()
        .set('performers', catalogPerformerIds.join(','))
        .set('limit', limit.toString()),
    });
  }

  /** Library scenes sharing these tags (by name), the rarer shared tags first. */
  getSimilarByTags(
    tagNames: readonly string[],
    excludeIds: readonly string[] = [],
    limit = 20,
  ): Observable<{ items: LibrarySceneItem[] }> {
    return this.http.post<{ items: LibrarySceneItem[] }>('/api/library/similar', {
      tagNames,
      excludeIds,
      limit,
    });
  }

  /** A random handful of library scenes not played yet (Up next). */
  getRandomUnplayed(
    excludeIds: readonly string[] = [],
    limit = 12,
  ): Observable<{ items: LibrarySceneItem[] }> {
    let params = new HttpParams().set('limit', limit.toString());
    if (excludeIds.length) {
      params = params.set('exclude', excludeIds.join(','));
    }
    return this.http.get<{ items: LibrarySceneItem[] }>('/api/library/unplayed', { params });
  }

  getRecommended(sceneId: string, limit = 20): Observable<{ items: LibrarySceneItem[] }> {
    return this.http.get<{ items: LibrarySceneItem[] }>(
      `/api/library/scenes/${encodeURIComponent(sceneId)}/recommended`,
      { params: new HttpParams().set('limit', limit.toString()) },
    );
  }

  searchTags(query: string): Observable<LibraryTagOption[]> {
    return this.http.get<LibraryTagOption[]>('/api/library/tags', {
      params: new HttpParams().set('query', query),
    });
  }

  searchStudios(query: string): Observable<LibraryStudioOption[]> {
    return this.http.get<LibraryStudioOption[]>('/api/library/studios', {
      params: new HttpParams().set('query', query),
    });
  }

  search(query: string, perPage: number): Observable<LibrarySearchResponse> {
    return this.http.get<LibrarySearchResponse>('/api/library/search', {
      params: new HttpParams().set('query', query).set('perPage', perPage.toString()),
    });
  }

  searchScenes(query: string, page: number, perPage: number): Observable<LibrarySearchScenes> {
    return this.http.get<LibrarySearchScenes>('/api/library/search/scenes', {
      params: new HttpParams()
        .set('query', query)
        .set('page', page.toString())
        .set('perPage', perPage.toString()),
    });
  }
}
