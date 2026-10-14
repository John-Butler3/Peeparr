import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsService } from '../api/app-settings.service';
import { DiscoverService } from '../api/discover.service';
import { AppNotificationsService } from '../notifications/app-notifications.service';
import { SceneQuickRequestService } from './scene-quick-request.service';

const NO_DEFAULTS = {
  hideAmateurNetworkResults: false,
  defaultRootFolderPath: null,
  defaultQualityProfileId: null,
  defaultMonitored: true,
  defaultSearchForMovie: true,
  defaultTagIds: [],
};

const WITH_DEFAULTS = {
  ...NO_DEFAULTS,
  defaultRootFolderPath: '/data/scenes',
  defaultQualityProfileId: 10,
  defaultMonitored: false,
  defaultSearchForMovie: true,
  defaultTagIds: [50],
};

describe('SceneQuickRequestService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function configure(overrides: {
    getPreferences?: ReturnType<typeof vi.fn>;
    submitSceneRequest?: ReturnType<typeof vi.fn>;
  }) {
    const appSettingsService = {
      getPreferences: overrides.getPreferences ?? vi.fn().mockReturnValue(of(NO_DEFAULTS)),
    };
    const discoverService = {
      submitSceneRequest: overrides.submitSceneRequest ?? vi.fn(),
    };
    const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: AppSettingsService, useValue: appSettingsService },
        { provide: DiscoverService, useValue: discoverService },
        { provide: AppNotificationsService, useValue: notifications },
      ],
    });

    return {
      service: TestBed.inject(SceneQuickRequestService),
      appSettingsService,
      discoverService,
      notifications,
    };
  }

  it('does not submit and reports not-submitted when no defaults are saved', async () => {
    const { service, discoverService } = configure({});

    const result = await firstValueFrom(service.tryQuickRequest('scene-1'));

    expect(result).toEqual({ submitted: false });
    expect(discoverService.submitSceneRequest).not.toHaveBeenCalled();
  });

  it('submits directly using the saved defaults and notifies on success', async () => {
    const { service, discoverService, notifications } = configure({
      getPreferences: vi.fn().mockReturnValue(of(WITH_DEFAULTS)),
      submitSceneRequest: vi.fn().mockReturnValue(
        of({ accepted: true, alreadyExists: false, stashId: 'scene-1', whisparrMovieId: 1 }),
      ),
    });

    const result = await firstValueFrom(service.tryQuickRequest('scene-1'));

    expect(result).toEqual({ submitted: true });
    expect(discoverService.submitSceneRequest).toHaveBeenCalledWith('scene-1', {
      monitored: false,
      rootFolderPath: '/data/scenes',
      searchForMovie: true,
      qualityProfileId: 10,
      tags: [50],
    });
    expect(notifications.success).toHaveBeenCalled();
  });

  it('reports not-submitted (without throwing) when the submit call fails', async () => {
    const { service } = configure({
      getPreferences: vi.fn().mockReturnValue(of(WITH_DEFAULTS)),
      submitSceneRequest: vi.fn().mockReturnValue(throwError(() => new Error('409'))),
    });

    const result = await firstValueFrom(service.tryQuickRequest('scene-1'));

    expect(result).toEqual({ submitted: false });
  });

  it('reports not-submitted when loading preferences itself fails', async () => {
    const { service } = configure({
      getPreferences: vi.fn().mockReturnValue(throwError(() => new Error('network error'))),
    });

    const result = await firstValueFrom(service.tryQuickRequest('scene-1'));

    expect(result).toEqual({ submitted: false });
  });

  it('treats only a root folder OR only a quality profile as "not configured"', async () => {
    const { service, discoverService } = configure({
      getPreferences: vi
        .fn()
        .mockReturnValue(of({ ...NO_DEFAULTS, defaultRootFolderPath: '/data/scenes' })),
    });

    const result = await firstValueFrom(service.tryQuickRequest('scene-1'));

    expect(result).toEqual({ submitted: false });
    expect(discoverService.submitSceneRequest).not.toHaveBeenCalled();
  });
});
