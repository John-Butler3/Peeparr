import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  GalleriesFeedResponse,
  GalleryFeedItem,
  GalleryFilterOption,
  GalleryImagesFeed,
} from './galleries.types';

@Injectable({
  providedIn: 'root',
})
export class GalleriesService {
  private readonly http = inject(HttpClient);

  getGalleriesFeed(
    page: number,
    perPage: number,
    filters?: {
      query?: string;
      tagIds?: string[];
      studioIds?: string[];
    },
  ): Observable<GalleriesFeedResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (filters?.query) {
      params = params.set('query', filters.query);
    }
    if (filters?.tagIds && filters.tagIds.length > 0) {
      params = params.set('tagIds', filters.tagIds.join(','));
    }
    if (filters?.studioIds && filters.studioIds.length > 0) {
      params = params.set('studioIds', filters.studioIds.join(','));
    }

    return this.http.get<GalleriesFeedResponse>('/api/galleries', { params });
  }

  getGalleryById(galleryId: string): Observable<GalleryFeedItem> {
    return this.http.get<GalleryFeedItem>(`/api/galleries/${encodeURIComponent(galleryId)}`);
  }

  getGalleryImages(
    galleryId: string,
    page: number,
    perPage: number,
  ): Observable<GalleryImagesFeed> {
    const params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    return this.http.get<GalleryImagesFeed>(
      `/api/galleries/${encodeURIComponent(galleryId)}/images`,
      { params },
    );
  }

  searchTags(query: string): Observable<GalleryFilterOption[]> {
    const params = new HttpParams().set('query', query);
    return this.http.get<GalleryFilterOption[]>('/api/galleries/tags', { params });
  }

  searchStudios(query: string): Observable<GalleryFilterOption[]> {
    const params = new HttpParams().set('query', query);
    return this.http.get<GalleryFilterOption[]>('/api/galleries/studios', { params });
  }
}
