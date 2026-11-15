import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AuthService } from '../api/auth.service';

/** The first check since the app was opened (a page load). */
let firstCheck = true;

export const requireAuthenticatedGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const opening = firstCheck;
  firstCheck = false;

  return authService.refreshStatus().pipe(
    // Lock on close: opened while a lock was pending means the app was
    // closed (not just switched away from), so it's locked now.
    switchMap((status) =>
      opening && status.authenticated && status.lockPending
        ? authService.lockNow().pipe(
            map(() => ({ ...status, authenticated: false })),
            catchError(() => of({ ...status, authenticated: false })),
          )
        : of(status),
    ),
    map((status) => {
      if (status.bootstrapRequired) {
        return router.createUrlTree(['/bootstrap']);
      }

      return status.authenticated ? true : router.createUrlTree(['/login']);
    }),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};

export const loginOnlyWhenLoggedOutGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.refreshStatus().pipe(
    map((status) => {
      if (status.bootstrapRequired) {
        return router.createUrlTree(['/bootstrap']);
      }

      return status.authenticated ? router.createUrlTree(['/']) : true;
    }),
    catchError(() => of(true)),
  );
};

export const bootstrapOnlyWhenRequiredGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.refreshStatus().pipe(
    map((status) => {
      if (status.bootstrapRequired) {
        return true;
      }

      return status.authenticated ? router.createUrlTree(['/']) : router.createUrlTree(['/login']);
    }),
    catchError(() => of(true)),
  );
};

/** For tests: as if the app had just been opened. */
export function resetFirstAuthCheck(): void {
  firstCheck = true;
}
