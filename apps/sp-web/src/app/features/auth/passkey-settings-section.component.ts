import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { AuthService } from '../../core/api/auth.service';
import { Passkey, PasskeyService, isPasskeyCancelled } from '../../core/api/passkey.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';

/**
 * Settings > Account: the admin's passkeys, for signing in with Face ID or
 * Touch ID. One is made on the device in hand; each can be removed.
 */
@Component({
  selector: 'app-passkey-settings-section',
  imports: [ButtonDirective, DatePipe, FormsModule, Message, ToggleSwitch],
  templateUrl: './passkey-settings-section.component.html',
  styleUrl: './account-settings-section.component.scss',
})
export class PasskeySettingsSectionComponent implements OnInit {
  private readonly passkeyService = inject(PasskeyService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly authService = inject(AuthService);

  protected readonly supported = this.passkeyService.supported();
  protected readonly label = this.passkeyService.label();
  protected readonly passkeys = signal<Passkey[]>([]);
  protected readonly loading = signal(true);
  protected readonly adding = signal(false);
  protected readonly removing = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  /** Sign out when the app is closed, so it asks for Face ID every time. */
  protected readonly lockOnClose = computed(() => this.authService.status()?.lockOnClose ?? false);
  protected readonly savingLock = signal(false);

  ngOnInit(): void {
    this.passkeyService.list().subscribe({
      next: (passkeys) => {
        this.loading.set(false);
        this.passkeys.set(passkeys);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set("Couldn't load your passkeys.");
      },
    });
  }

  protected add(): void {
    this.errorMessage.set(null);
    this.adding.set(true);
    this.passkeyService.register().subscribe({
      next: (passkey) => {
        this.adding.set(false);
        this.passkeys.update((list) => [...list, passkey]);
        this.notifications.success(
          this.label === 'a passkey' ? 'Passkey added' : `${this.label} sign-in added`,
          'Next time, sign in with it instead of the password.',
        );
      },
      error: (error: unknown) => {
        this.adding.set(false);
        if (isPasskeyCancelled(error)) {
          return;
        }
        this.errorMessage.set(
          (error as { name?: string } | null)?.name === 'InvalidStateError'
            ? 'This device already has a passkey for Peeparr.'
            : error instanceof HttpErrorResponse
              ? (readApiMessage(error) ?? "Couldn't add the passkey.")
              : "Couldn't add the passkey.",
        );
      },
    });
  }

  protected setLockOnClose(enabled: boolean): void {
    this.savingLock.set(true);
    this.authService.setLockOnClose(enabled).subscribe({
      next: () => {
        this.savingLock.set(false);
        this.notifications.success(
          enabled ? 'Locks when closed' : 'Stays signed in',
          enabled
            ? `Opening Peeparr again will ask for ${this.label === 'a passkey' ? 'a passkey' : this.label} or your password.`
            : 'Peeparr stays signed in for 30 days.',
        );
      },
      error: () => {
        this.savingLock.set(false);
        this.errorMessage.set("Couldn't change the lock setting.");
      },
    });
  }

  protected remove(passkey: Passkey): void {
    this.errorMessage.set(null);
    this.removing.set(passkey.id);
    this.passkeyService.remove(passkey.id).subscribe({
      next: () => {
        this.removing.set(null);
        this.passkeys.update((list) => list.filter((item) => item.id !== passkey.id));
        this.notifications.success(
          'Passkey removed',
          `Also delete "Peeparr" from that device's Passwords app, so it stops offering it.`,
        );
      },
      error: (error: unknown) => {
        this.removing.set(null);
        this.errorMessage.set(
          error instanceof HttpErrorResponse
            ? (readApiMessage(error) ?? "Couldn't remove the passkey.")
            : "Couldn't remove the passkey.",
        );
      },
    });
  }
}

function readApiMessage(error: HttpErrorResponse): string | null {
  const message = error.error?.message;
  if (Array.isArray(message) && message.length > 0) {
    return message[0] ?? null;
  }
  return typeof message === 'string' ? message : null;
}
