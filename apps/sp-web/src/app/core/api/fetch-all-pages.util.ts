import { EMPTY, Observable, expand, reduce } from 'rxjs';

export interface PagedResult<T> {
  items: T[];
  hasMore: boolean;
}

// A generous safety cap so a backend bug (hasMore never going false) can't
// spin this into an unbounded fetch loop -- no real performer/studio scene
// list should ever come close to this many pages.
const MAX_PAGES = 250;

/**
 * Repeatedly calls loadPage(1), loadPage(2), ... until hasMore is false (or
 * the safety cap is hit), accumulating every page's items into one array.
 * Used to work around catalog providers (e.g. TPDB) that only support a
 * single fixed sort order: fetch everything in the order the provider
 * actually gives, then sort the full list locally.
 */
export function fetchAllPages<T>(
  loadPage: (page: number) => Observable<PagedResult<T>>,
): Observable<T[]> {
  return loadPage(1).pipe(
    expand((result, index) => {
      const nextPage = index + 2;
      if (!result.hasMore || nextPage > MAX_PAGES) {
        return EMPTY;
      }

      return loadPage(nextPage);
    }),
    reduce<PagedResult<T>, T[]>((accumulated, result) => [...accumulated, ...result.items], []),
  );
}
