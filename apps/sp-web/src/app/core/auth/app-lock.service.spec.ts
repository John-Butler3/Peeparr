import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../api/auth.service';
import { AppLockService } from './app-lock.service';

describe('AppLockService', () => {
  let visibility: DocumentVisibilityState = 'visible';
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const status = signal<{ lockOnClose?: boolean } | null>(null);
  const authService = {
    status,
    resume: vi.fn(),
    clearStatus: vi.fn(),
  };

  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    authService.resume.mockReset();
    authService.clearStatus.mockReset();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    });
  });

  afterEach(() => {
    TestBed.inject(AppLockService).stop();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    document.querySelectorAll('video').forEach((video) => video.remove());
  });

  function leave(): void {
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
  }

  function comeBack(): void {
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('does nothing when lock on close is off', () => {
    status.set({ lockOnClose: false });
    TestBed.inject(AppLockService).start();
    leave();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts the lock on leaving, and calls it off on coming back in time', () => {
    status.set({ lockOnClose: true });
    authService.resume.mockReturnValue(of(undefined));
    TestBed.inject(AppLockService).start();

    leave();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/lock',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );

    comeBack();
    expect(authService.resume).toHaveBeenCalledTimes(1);
  });

  it('goes to sign in when back too late', () => {
    status.set({ lockOnClose: true });
    authService.resume.mockReturnValue(throwError(() => new Error('401')));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(AppLockService).start();

    leave();
    comeBack();

    expect(authService.clearStatus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it("doesn't lock while a video plays with sound", () => {
    status.set({ lockOnClose: true });
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { get: () => false });
    document.body.appendChild(video);
    TestBed.inject(AppLockService).start();

    leave();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
