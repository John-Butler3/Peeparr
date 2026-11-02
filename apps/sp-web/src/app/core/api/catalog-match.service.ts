import { Injectable, inject } from '@angular/core';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';
import { DiscoverService } from './discover.service';

const nameKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * A library performer or site's page in the catalog, found by name (a library
 * scene only has Stash's own ids for them). Null when the catalog has none of
 * that name. Each is looked up once.
 */
@Injectable({ providedIn: 'root' })
export class CatalogMatchService {
  private readonly discover = inject(DiscoverService);
  private readonly performers = new Map<string, Promise<string | null>>();
  private readonly studios = new Map<string, Promise<string | null>>();

  performerId(name: string): Promise<string | null> {
    return this.once(this.performers, name, () =>
      this.discover.getPerformersFeed(1, 10, { name }).pipe(
        map(({ items }) => {
          const named = items.filter((item) => nameKey(item.name) === nameKey(name));
          // Several of that name: the busiest (a performer's main profile).
          return named.sort((a, b) => b.sceneCount - a.sceneCount)[0]?.id ?? null;
        }),
      ),
    );
  }

  studioId(name: string): Promise<string | null> {
    return this.once(this.studios, name, () =>
      this.discover
        .getStudiosFeed(1, 10, { name })
        .pipe(
          map(
            ({ items }) => items.find((item) => nameKey(item.name) === nameKey(name))?.id ?? null,
          ),
        ),
    );
  }

  private once(
    found: Map<string, Promise<string | null>>,
    name: string,
    lookUp: () => Observable<string | null>,
  ): Promise<string | null> {
    const key = nameKey(name);
    let match = found.get(key);
    if (!match) {
      match = firstValueFrom(
        lookUp().pipe(
          catchError(() => {
            // Not an answer: tried again next time.
            found.delete(key);
            return of(null);
          }),
        ),
      );
      found.set(key, match);
    }
    return match;
  }
}
