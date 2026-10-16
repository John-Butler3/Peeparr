import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NetworkSettings, NetworkSettingsService } from '../../core/api/network-settings.service';

export type RemoteAccessMode = 'none' | 'proxy' | 'custom';

/**
 * Remote access: whether Peeparr sits behind a reverse proxy, so it sees
 * visitors' real addresses (sign-in limits) and HTTPS (secure cookies).
 * Used in setup and Settings; applies straight away.
 */
@Component({
  selector: 'app-remote-access-settings',
  imports: [FormsModule],
  templateUrl: './remote-access-settings.component.html',
  styleUrl: './remote-access-settings.component.scss',
})
export class RemoteAccessSettingsComponent {
  private readonly networkSettings = inject(NetworkSettingsService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedMessage = signal<string | null>(null);
  protected readonly settings = signal<NetworkSettings | null>(null);
  protected readonly mode = signal<RemoteAccessMode>('none');
  protected readonly customValue = signal('');

  protected readonly locked = computed(() => this.settings()?.lockedByEnvironment === true);
  /** Arrived through a proxy that isn't trusted yet. */
  protected readonly proxyNotTrusted = computed(() => {
    const settings = this.settings();
    return !!settings && settings.connectedThroughProxy && settings.effectiveTrustProxy === null;
  });
  // Something to save: a different choice, or "specific address" picked with
  // the box still empty (Save then asks for the address).
  protected readonly dirty = computed(
    () =>
      this.valueFor(this.mode()) !== (this.settings()?.trustProxy ?? null) ||
      (this.mode() === 'custom' && !this.customValue().trim()),
  );

  constructor() {
    this.networkSettings.get().subscribe({
      next: (settings) => this.show(settings),
      error: () => {
        this.loading.set(false);
        this.error.set("Couldn't load the remote access setting.");
      },
    });
  }

  protected choose(mode: RemoteAccessMode): void {
    this.mode.set(mode);
    this.savedMessage.set(null);
    this.error.set(null);
  }

  protected save(): void {
    if (this.saving() || this.locked()) {
      return;
    }
    const value = this.valueFor(this.mode());
    if (this.mode() === 'custom' && !value) {
      this.error.set('Enter the proxy\'s address, like 10.0.0.2 or 172.16.0.0/12.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.networkSettings.update(value).subscribe({
      next: (settings) => {
        this.saving.set(false);
        this.show(settings);
        this.savedMessage.set(value ? 'Saved. Peeparr now trusts your proxy.' : 'Saved.');
      },
      error: (response) => {
        this.saving.set(false);
        this.error.set(response?.error?.message ?? "Couldn't save. Please try again.");
      },
    });
  }

  private show(settings: NetworkSettings): void {
    this.settings.set(settings);
    this.loading.set(false);
    const value = settings.lockedByEnvironment ? settings.effectiveTrustProxy : settings.trustProxy;
    if (!value) {
      this.mode.set('none');
    } else if (value === '1') {
      this.mode.set('proxy');
    } else {
      this.mode.set('custom');
      this.customValue.set(value);
    }
  }

  private valueFor(mode: RemoteAccessMode): string | null {
    switch (mode) {
      case 'none':
        return null;
      case 'proxy':
        return '1';
      case 'custom':
        return this.customValue().trim() || null;
    }
  }
}
