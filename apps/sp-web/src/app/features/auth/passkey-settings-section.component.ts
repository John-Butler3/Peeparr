import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { Passkey, PasskeyService, isPasskeyCancelled } from '../../core/api/passkey.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';

/**
 * Settings > Account: the admin's passkeys, for signing in with Face ID or
 * Touch ID. One is made on the device in hand; each can be removed.
 */
@Component({
  selector: 'app-passkey-settings-section',
  imports: [ButtonDirective, DatePipe, Message],
  templateUrl: './passkey-settings-section.component.html',
  styleUrl: './account-settings-section.component.scss',
})
export class PasskeySettingsSectionComponent implements OnInit {
  private readonly passkeyService = inject(PasskeyService);
  private readonly notifications = inject(AppNotificationsService);

  protected readonly supported = this.passkeyService.supported();
  protected readonly label = this.passkeyService.label();
  protected readonly passkeys = signal<Passkey[]>([]);
  protected readonly loading = signal(true);
  protected readonly adding = signal(false);
  protected readonly removing = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

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
