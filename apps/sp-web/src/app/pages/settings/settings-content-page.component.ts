import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { AppSettingsService } from '../../core/api/app-settings.service';
import { DiscoverService } from '../../core/api/discover.service';
import { DownloadProfileOptions } from '../../core/api/discover.types';

type StringSelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

type NumberSelectOption = {
  label: string;
  value: number;
};

const NO_DEFAULT = '';

@Component({
  selector: 'app-settings-content-page',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonDirective,
    Message,
    ProgressSpinner,
    ToggleSwitch,
    Select,
    MultiSelect,
  ],
  templateUrl: './settings-content-page.component.html',
  styleUrl: './settings-content-page.component.scss',
})
export class SettingsContentPageComponent implements OnInit {
  private readonly appSettingsService = inject(AppSettingsService);
  private readonly discoverService = inject(DiscoverService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly hideAmateurNetworkResults = signal(false);

  protected readonly downloadProfileOptions = signal<DownloadProfileOptions | null>(null);
  protected readonly downloadProfileOptionsError = signal<string | null>(null);
  protected readonly downloadProfileSaving = signal(false);
  protected readonly downloadProfileSaveError = signal<string | null>(null);
  protected readonly downloadProfileSaved = signal(false);

  protected readonly rootFolderOptions = computed<StringSelectOption[]>(() => {
    const options = this.downloadProfileOptions();
    if (!options) {
      return [];
    }

    return [
      { label: 'None — always ask', value: NO_DEFAULT },
      ...options.rootFolders.map((folder) => ({
        label: folder.accessible ? folder.path : `${folder.path} (Unavailable)`,
        value: folder.path,
        disabled: !folder.accessible,
      })),
    ];
  });

  protected readonly qualityProfileOptions = computed<NumberSelectOption[]>(() => {
    const options = this.downloadProfileOptions();
    if (!options) {
      return [];
    }

    return [
      { label: 'None — always ask', value: 0 },
      ...options.qualityProfiles.map((profile) => ({ label: profile.name, value: profile.id })),
    ];
  });

  protected readonly tagOptions = computed<NumberSelectOption[]>(() => {
    const options = this.downloadProfileOptions();
    if (!options) {
      return [];
    }

    return options.tags.map((tag) => ({ label: tag.label, value: tag.id }));
  });

  protected readonly downloadProfileForm = new FormGroup({
    rootFolderPath: new FormControl(NO_DEFAULT, { nonNullable: true }),
    qualityProfileId: new FormControl(0, { nonNullable: true }),
    monitored: new FormControl(true, { nonNullable: true }),
    searchForMovie: new FormControl(true, { nonNullable: true }),
    tagIds: new FormControl<number[]>([], { nonNullable: true }),
  });

  ngOnInit(): void {
    this.loadPreferences();
  }

  protected retryLoad(): void {
    this.loadPreferences();
  }

  protected onHideAmateurNetworkResultsChanged(nextValue: boolean): void {
    const previousValue = this.hideAmateurNetworkResults();
    this.hideAmateurNetworkResults.set(nextValue);
    this.saving.set(true);
    this.saveError.set(null);

    this.appSettingsService
      .updatePreferences({ hideAmateurNetworkResults: nextValue })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (settings) => {
          this.hideAmateurNetworkResults.set(settings.hideAmateurNetworkResults);
        },
        error: () => {
          this.hideAmateurNetworkResults.set(previousValue);
          this.saveError.set('Failed to save. Please try again.');
        },
      });
  }

  protected saveDownloadProfile(): void {
    this.downloadProfileSaving.set(true);
    this.downloadProfileSaveError.set(null);
    this.downloadProfileSaved.set(false);

    const value = this.downloadProfileForm.getRawValue();

    this.appSettingsService
      .updatePreferences({
        defaultRootFolderPath: value.rootFolderPath || null,
        defaultQualityProfileId: value.qualityProfileId || null,
        defaultMonitored: value.monitored,
        defaultSearchForMovie: value.searchForMovie,
        defaultTagIds: value.tagIds,
      })
      .pipe(finalize(() => this.downloadProfileSaving.set(false)))
      .subscribe({
        next: (settings) => {
          this.patchDownloadProfileForm(settings);
          this.downloadProfileSaved.set(true);
        },
        error: () => {
          this.downloadProfileSaveError.set('Failed to save. Please try again.');
        },
      });
  }

  private loadPreferences(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.downloadProfileOptionsError.set(null);

    forkJoin({
      settings: this.appSettingsService.getPreferences(),
      // Fetching root folders/quality profiles requires a configured Whisparr
      // integration; don't let that failure take down the rest of this page
      // (including the unrelated hideAmateurNetworkResults toggle above it).
      downloadProfileOptions: this.discoverService.getDownloadProfileOptions().pipe(
        catchError(() => {
          this.downloadProfileOptionsError.set(
            'Failed to load Whisparr root folders and quality profiles. Configure the Whisparr integration first.',
          );
          return of(null);
        }),
      ),
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ settings, downloadProfileOptions }) => {
          this.hideAmateurNetworkResults.set(settings.hideAmateurNetworkResults);
          this.downloadProfileOptions.set(downloadProfileOptions);
          this.patchDownloadProfileForm(settings);
        },
        error: () => {
          this.loadError.set('Failed to load content preferences.');
        },
      });
  }

  private patchDownloadProfileForm(settings: {
    defaultRootFolderPath: string | null;
    defaultQualityProfileId: number | null;
    defaultMonitored: boolean;
    defaultSearchForMovie: boolean;
    defaultTagIds: number[];
  }): void {
    this.downloadProfileForm.setValue({
      rootFolderPath: settings.defaultRootFolderPath ?? NO_DEFAULT,
      qualityProfileId: settings.defaultQualityProfileId ?? 0,
      monitored: settings.defaultMonitored,
      searchForMovie: settings.defaultSearchForMovie,
      tagIds: settings.defaultTagIds,
    });
  }
}
