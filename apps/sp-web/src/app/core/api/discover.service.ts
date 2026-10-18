import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DiscoverResponse,
  PerformerDetails,
  PerformerFeedResponse,
  PerformerGender,
  PerformerSort,
  PerformerStudioOption,
  FavoriteMutationResponse,
  PerformerMonitoringState,
  StudioFeedResponse,
  StudioFeedSort,
  SceneFavoritesFilter,
  SceneFeedSort,
  SortDirection,
  SceneTagMatchMode,
  SceneTagOption,
  ScenePlaybackSource,
  DownloadProfileOptions,
  SceneDetails,
  SceneRequestOptions,
  ScenesFeedResponse,
  SimilarScenesResponse,
  SubmitSceneRequestPayload,
  SubmitSceneRequestResponse,
  StudioDetails,
} from './discover.types';

@Injectable({
  providedIn: 'root',
})
export class DiscoverService {
  private readonly http = inject(HttpClient);

  /** ThePornDB website's popular scenes; empty without a TPDB website login. */
  getPopularScenes(): Observable<ScenesFeedResponse> {
    return this.http.get<ScenesFeedResponse>('/api/scenes/popular');
  }

  getScenesFeed(
    page: number,
    perPage: number,
    sort?: SceneFeedSort,
    direction?: SortDirection,
    tagIds?: string[],
    tagMode?: SceneTagMatchMode,
    favorites?: SceneFavoritesFilter,
    studioIds?: string[],
    titleQuery?: string,
  ): Observable<ScenesFeedResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (sort) {
      params = params.set('sort', sort);
    }
    if (direction) {
      params = params.set('direction', direction);
    }
    if (tagIds && tagIds.length > 0) {
      params = params.set('tagIds', tagIds.join(','));
    }
    if (tagMode) {
      params = params.set('tagMode', tagMode);
    }
    if (favorites) {
      params = params.set('favorites', favorites);
    }
    if (studioIds && studioIds.length > 0) {
      params = params.set('studioIds', studioIds.join(','));
    }
    if (titleQuery && titleQuery.trim().length > 0) {
      params = params.set('titleQuery', titleQuery.trim());
    }

    return this.http.get<ScenesFeedResponse>('/api/scenes', { params });
  }

  searchSceneTags(query: string): Observable<SceneTagOption[]> {
    const params = new HttpParams().set('query', query);
    return this.http.get<SceneTagOption[]>('/api/scenes/tags', { params });
  }

  getSceneDetails(stashId: string): Observable<SceneDetails> {
    return this.http.get<SceneDetails>(`/api/scenes/${encodeURIComponent(stashId)}`);
  }

  getSimilarScenes(stashId: string, limit?: number): Observable<SimilarScenesResponse> {
    let params = new HttpParams();
    if (limit) {
      params = params.set('limit', limit.toString());
    }

    return this.http.get<SimilarScenesResponse>(
      `/api/scenes/${encodeURIComponent(stashId)}/similar`,
      { params },
    );
  }

  getSceneStreamUrl(stashId: string, copyId?: string): Observable<ScenePlaybackSource> {
    let params = new HttpParams();
    if (copyId) {
      params = params.set('copyId', copyId);
    }

    return this.http.get<ScenePlaybackSource>(`/api/scenes/${encodeURIComponent(stashId)}/stream`, {
      params,
    });
  }

  getSceneRequestOptions(stashId: string): Observable<SceneRequestOptions> {
    return this.http.get<SceneRequestOptions>(
      `/api/requests/${encodeURIComponent(stashId)}/options`,
    );
  }

  getDownloadProfileOptions(): Observable<DownloadProfileOptions> {
    return this.http.get<DownloadProfileOptions>('/api/requests/options');
  }

  submitSceneRequest(
    stashId: string,
    payload: SubmitSceneRequestPayload,
  ): Observable<SubmitSceneRequestResponse> {
    return this.http.post<SubmitSceneRequestResponse>(
      `/api/requests/${encodeURIComponent(stashId)}`,
      payload,
    );
  }

  getPerformersFeed(
    page: number,
    perPage: number,
    filters?: {
      name?: string;
      gender?: PerformerGender;
      sort?: PerformerSort;
      direction?: SortDirection;
      favoritesOnly?: boolean;
    },
  ): Observable<PerformerFeedResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (filters?.name) {
      params = params.set('name', filters.name);
    }
    if (filters?.gender) {
      params = params.set('gender', filters.gender);
    }
    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.favoritesOnly) {
      params = params.set('favoritesOnly', 'true');
    }
    return this.http.get<PerformerFeedResponse>('/api/performers', { params });
  }

  getPerformerDetails(performerId: string): Observable<PerformerDetails> {
    return this.http.get<PerformerDetails>(`/api/performers/${encodeURIComponent(performerId)}`);
  }

  setPerformerMainImage(performerId: string, imageUrl: string): Observable<PerformerDetails> {
    return this.http.patch<PerformerDetails>(
      `/api/performers/${encodeURIComponent(performerId)}/main-image`,
      { imageUrl },
    );
  }

  getPerformerScenesFeed(
    performerId: string,
    page: number,
    perPage: number,
    filters?: {
      sort?: SceneFeedSort;
      direction?: SortDirection;
      studioIds?: string[];
      tagIds?: string[];
      onlyFavoriteStudios?: boolean;
    },
  ): Observable<DiscoverResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.studioIds && filters.studioIds.length > 0) {
      params = params.set('studioIds', filters.studioIds.join(','));
    }
    if (filters?.tagIds && filters.tagIds.length > 0) {
      params = params.set('tagIds', filters.tagIds.join(','));
    }
    if (filters?.onlyFavoriteStudios) {
      params = params.set('onlyFavoriteStudios', 'true');
    }

    return this.http.get<DiscoverResponse>(
      `/api/performers/${encodeURIComponent(performerId)}/scenes`,
      { params },
    );
  }

  /** ThePornDB website's popular sites (empty without a website login). */
  getPopularStudios(): Observable<StudioFeedResponse> {
    return this.http.get<StudioFeedResponse>('/api/studios/popular');
  }

  /** ThePornDB website's popular performers (empty without a website login). */
  getPopularPerformers(): Observable<PerformerFeedResponse> {
    return this.http.get<PerformerFeedResponse>('/api/performers/popular');
  }

  searchPerformerStudios(query: string): Observable<PerformerStudioOption[]> {
    const params = new HttpParams().set('query', query);
    return this.http.get<PerformerStudioOption[]>('/api/performers/studios', {
      params,
    });
  }

  favoritePerformer(performerId: string, favorite: boolean): Observable<FavoriteMutationResponse> {
    return this.http.post<FavoriteMutationResponse>(
      `/api/performers/${encodeURIComponent(performerId)}/favorite`,
      { favorite },
    );
  }

  getPerformerMonitoring(performerId: string): Observable<PerformerMonitoringState> {
    return this.http.get<PerformerMonitoringState>(
      `/api/performers/${encodeURIComponent(performerId)}/monitoring`,
    );
  }

  setPerformerMonitoring(
    performerId: string,
    monitored: boolean,
  ): Observable<PerformerMonitoringState> {
    return this.http.put<PerformerMonitoringState>(
      `/api/performers/${encodeURIComponent(performerId)}/monitoring`,
      { monitored },
    );
  }

  favoriteStudio(studioId: string, favorite: boolean): Observable<FavoriteMutationResponse> {
    return this.http.post<FavoriteMutationResponse>(
      `/api/scenes/studios/${encodeURIComponent(studioId)}/favorite`,
      { favorite },
    );
  }

  getStudiosFeed(
    page: number,
    perPage: number,
    filters?: {
      name?: string;
      sort?: StudioFeedSort;
      direction?: SortDirection;
      favoritesOnly?: boolean;
    },
  ): Observable<StudioFeedResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (filters?.name) {
      params = params.set('name', filters.name);
    }
    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.favoritesOnly) {
      params = params.set('favoritesOnly', 'true');
    }

    return this.http.get<StudioFeedResponse>('/api/studios', { params });
  }

  getStudioDetails(studioId: string): Observable<StudioDetails> {
    return this.http.get<StudioDetails>(`/api/studios/${encodeURIComponent(studioId)}`);
  }
}
