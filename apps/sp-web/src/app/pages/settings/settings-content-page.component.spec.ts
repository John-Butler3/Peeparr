import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsService } from '../../core/api/app-settings.service';
import { DiscoverService } from '../../core/api/discover.service';
import { SettingsContentPageComponent } from './settings-content-page.component';

const FULL_SETTINGS = {
  hideAmateurNetworkResults: true,
  defaultRootFolderPath: null,
  defaultQualityProfileId: null,
  defaultMonitored: true,
  defaultSearchForMovie: true,
  defaultTagIds: [],
};

const DOWNLOAD_PROFILE_OPTIONS = {
  rootFolders: [{ id: 1, path: '/data/scenes', accessible: true }],
  qualityProfiles: [{ id: 10, name: 'Default' }],
  tags: [{ id: 50, label: 'VR' }],
};

describe('SettingsContentPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function configure(overrides: {
    getPreferences?: ReturnType<typeof vi.fn>;
    updatePreferences?: ReturnType<typeof vi.fn>;
    getDownloadProfileOptions?: ReturnType<typeof vi.fn>;
  }) {
    const appSettingsService = {
      getPreferences: overrides.getPreferences ?? vi.fn().mockReturnValue(of(FULL_SETTINGS)),
      updatePreferences: overrides.updatePreferences ?? vi.fn(),
    };
    const discoverService = {
      getDownloadProfileOptions:
        overrides.getDownloadProfileOptions ?? vi.fn().mockReturnValue(of(DOWNLOAD_PROFILE_OPTIONS)),
    };

    return TestBed.configureTestingModule({
      imports: [SettingsContentPageComponent],
      providers: [
        { provide: AppSettingsService, useValue: appSettingsService },
        { provide: DiscoverService, useValue: discoverService },
      ],
    })
      .compileComponents()
      .then(() => ({ appSettingsService, discoverService }));
  }

  it('loads and displays the current preference', async () => {
    const { appSettingsService } = await configure({});

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(appSettingsService.getPreferences).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Enabled');
  });

  it('saves the toggle change and reflects the server response', async () => {
    const { appSettingsService } = await configure({
      getPreferences: vi.fn().mockReturnValue(of({ ...FULL_SETTINGS, hideAmateurNetworkResults: false })),
      updatePreferences: vi.fn().mockReturnValue(of({ ...FULL_SETTINGS, hideAmateurNetworkResults: true })),
    });

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onHideAmateurNetworkResultsChanged(value: boolean): void;
      hideAmateurNetworkResults: () => boolean;
    };
    component.onHideAmateurNetworkResultsChanged(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(appSettingsService.updatePreferences).toHaveBeenCalledWith({
      hideAmateurNetworkResults: true,
    });
    expect(component.hideAmateurNetworkResults()).toBe(true);
  });

  it('reverts the toggle and shows an error when saving fails', async () => {
    await configure({
      getPreferences: vi.fn().mockReturnValue(of({ ...FULL_SETTINGS, hideAmateurNetworkResults: false })),
      updatePreferences: vi.fn().mockReturnValue(throwError(() => new Error('network error'))),
    });

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      onHideAmateurNetworkResultsChanged(value: boolean): void;
      hideAmateurNetworkResults: () => boolean;
    };
    component.onHideAmateurNetworkResultsChanged(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.hideAmateurNetworkResults()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Failed to save');
  });

  it('saves the default download profile fields together', async () => {
    const { appSettingsService } = await configure({
      updatePreferences: vi.fn().mockReturnValue(
        of({
          ...FULL_SETTINGS,
          defaultRootFolderPath: '/data/scenes',
          defaultQualityProfileId: 10,
          defaultTagIds: [50],
        }),
      ),
    });

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      downloadProfileForm: {
        setValue(value: {
          rootFolderPath: string;
          qualityProfileId: number;
          monitored: boolean;
          searchForMovie: boolean;
          tagIds: number[];
        }): void;
      };
      saveDownloadProfile(): void;
      downloadProfileSaved: () => boolean;
    };
    component.downloadProfileForm.setValue({
      rootFolderPath: '/data/scenes',
      qualityProfileId: 10,
      monitored: true,
      searchForMovie: true,
      tagIds: [50],
    });
    component.saveDownloadProfile();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(appSettingsService.updatePreferences).toHaveBeenCalledWith({
      defaultRootFolderPath: '/data/scenes',
      defaultQualityProfileId: 10,
      defaultMonitored: true,
      defaultSearchForMovie: true,
      defaultTagIds: [50],
    });
    expect(component.downloadProfileSaved()).toBe(true);
  });

  it('sends null when the root folder/quality profile are left as "None"', async () => {
    const { appSettingsService } = await configure({
      updatePreferences: vi.fn().mockReturnValue(of(FULL_SETTINGS)),
    });

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      saveDownloadProfile(): void;
    };
    component.saveDownloadProfile();
    await fixture.whenStable();

    expect(appSettingsService.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ defaultRootFolderPath: null, defaultQualityProfileId: null }),
    );
  });

  it('still loads the page when fetching Whisparr options fails (e.g. not configured yet)', async () => {
    await configure({
      getDownloadProfileOptions: vi.fn().mockReturnValue(throwError(() => new Error('not configured'))),
    });

    const fixture = TestBed.createComponent(SettingsContentPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      loadError: () => string | null;
      downloadProfileOptionsError: () => string | null;
    };

    expect(component.loadError()).toBeNull();
    expect(component.downloadProfileOptionsError()).toContain('Whisparr');
  });
});
