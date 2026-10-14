import { RouterLink } from '@angular/router';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { HealthService } from '../../core/api/health.service';
import { HealthStatusResponse } from '../../core/api/health.types';
import { integrationLabel } from '../../core/api/integrations.types';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SetupStatusResponse, summarizeDegradedSetupState } from '../../core/api/setup.types';

@Component({
  selector: 'app-settings-overview-page',
  imports: [Message, ProgressSpinner, RouterLink],
  templateUrl: './settings-overview-page.component.html',
  styleUrl: './settings-overview-page.component.scss',
})
export class SettingsOverviewPageComponent implements OnInit {
  protected readonly sections = [
    {
      route: '/settings/integrations',
      icon: 'pi pi-link',
      title: 'Integrations',
      description: 'Stash, Whisparr and your catalog',
    },
    {
      route: '/settings/indexing',
      icon: 'pi pi-sync',
      title: 'Indexing',
      description: 'Keep your library and scene statuses up to date',
    },
    {
      route: '/settings/content',
      icon: 'pi pi-sliders-h',
      title: 'Content',
      description: 'What shows while browsing, and request defaults',
    },
    {
      route: '/settings/account',
      icon: 'pi pi-user',
      title: 'Account',
      description: 'Your admin password',
    },
    {
      route: '/settings/about',
      icon: 'pi pi-info-circle',
      title: 'About',
      description: 'Version, links and release notes',
    },
  ];

  private readonly setupService = inject(SetupService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly healthService = inject(HealthService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly setupStatus = signal<SetupStatusResponse | null>(null);
  protected readonly health = signal<HealthStatusResponse | null>(null);

  protected readonly degradedState = computed(() =>
    summarizeDegradedSetupState(this.setupStatus()),
  );

  protected readonly readyCount = computed(() => {
    const status = this.setupStatus();
    if (!status) {
      return 0;
    }

    return Number(status.required.catalog) + Number(status.required.stash) + Number(status.required.whisparr);
  });

  protected readonly progressSummary = computed(() =>
    this.setupStatus() ? `${this.readyCount()} of 3 required services ready` : 'Required service status unavailable',
  );

  protected readonly catalogProviderLabel = computed(() => {
    const catalogProvider = this.setupStatus()?.catalogProvider;
    return catalogProvider ? integrationLabel(catalogProvider) : 'Not chosen';
  });

  protected readonly statusTone = computed<'good' | 'warn'>(() => {
    if (this.loadError() || !this.setupStatus()) {
      return 'warn';
    }

    return this.degradedState() ? 'warn' : 'good';
  });

  protected readonly statusLabel = computed(() =>
    this.loadError() || !this.setupStatus()
      ? 'Unavailable'
      : this.degradedState()
        ? 'Needs attention'
        : 'Healthy',
  );

  protected readonly statusLead = computed(() => {
    if (this.loadError() || !this.setupStatus()) {
      return 'Required service readiness could not be loaded right now.';
    }

    if (this.degradedState()) {
      return this.degradedState()!.message;
    }

    return 'Every required integration is ready and the app is ready for normal use.';
  });

  ngOnInit(): void {
    this.loadOverview();
  }

  private loadOverview(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.setupService
      .getStatus()
      .pipe(
        catchError(() => of(null)),
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe((setupStatus) => {
        if (!setupStatus) {
          this.loadError.set('Failed to load the latest integration readiness summary.');
          return;
        }

        this.setupStatus.set(setupStatus);
        this.setupStatusStore.sync(setupStatus);
      });

    this.healthService
      .getStatus()
      .pipe(catchError(() => of(null)))
      .subscribe((health) => {
        if (!health) {
          return;
        }

        this.health.set(health);
      });
  }
}
