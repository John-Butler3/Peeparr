import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/api/auth.service';
import { PasskeyService } from '../../core/api/passkey.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { PasskeySettingsSectionComponent } from './passkey-settings-section.component';

describe('PasskeySettingsSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  const iphone = {
    id: 'p1',
    name: 'iPhone',
    createdAt: '2026-11-16T09:00:00.000Z',
    lastUsedAt: null,
  };

  async function render(passkeys: Partial<Record<keyof PasskeyService, unknown>>) {
    const service = {
      supported: () => true,
      label: () => 'Face ID',
      list: vi.fn().mockReturnValue(of([])),
      register: vi.fn(),
      remove: vi.fn(),
      ...passkeys,
    };
    const notifications = { success: vi.fn(), error: vi.fn() };
    const status = signal({
      authenticated: true,
      bootstrapRequired: false,
      username: 'admin',
      lockOnClose: false,
    });
    const authService = {
      status,
      setLockOnClose: vi.fn((enabled: boolean) => {
        status.update((current) => ({ ...current, lockOnClose: enabled }));
        return of({ lockOnClose: enabled });
      }),
    };
    await TestBed.configureTestingModule({
      imports: [PasskeySettingsSectionComponent],
      providers: [
        { provide: PasskeyService, useValue: service },
        { provide: AppNotificationsService, useValue: notifications },
        { provide: AuthService, useValue: authService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PasskeySettingsSectionComponent);
    fixture.detectChanges();
    return {
      fixture,
      service,
      notifications,
      authService,
      element: fixture.nativeElement as HTMLElement,
    };
  }

  it('adds a Face ID passkey on this device and lists it', async () => {
    const { fixture, element, service, notifications } = await render({
      register: vi.fn().mockReturnValue(of(iphone)),
    });
    const add = element.querySelector('[data-testid="passkey-add"]') as HTMLButtonElement;
    expect(add.textContent).toContain('Add Face ID');

    add.click();
    fixture.detectChanges();

    expect(service.register).toHaveBeenCalledTimes(1);
    expect(element.querySelector('.passkey-row')?.textContent).toContain('iPhone');
    expect(notifications.success).toHaveBeenCalledWith('Face ID sign-in added', expect.any(String));
  });

  it('says nothing when Face ID is cancelled, and removes a passkey', async () => {
    const cancelled = Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
    const { fixture, element, service } = await render({
      list: vi.fn().mockReturnValue(of([iphone])),
      register: vi.fn().mockReturnValue(throwError(() => cancelled)),
      remove: vi.fn().mockReturnValue(of(undefined)),
    });

    (element.querySelector('[data-testid="passkey-add"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.querySelector('p-message[severity="error"]')).toBeNull();

    const remove = Array.from(element.querySelectorAll('.passkey-row button')).find((button) =>
      button.textContent?.includes('Remove'),
    ) as HTMLButtonElement;
    remove.click();
    fixture.detectChanges();

    expect(service.remove).toHaveBeenCalledWith('p1');
    expect(element.querySelector('.passkey-row')).toBeNull();
  });

  it('explains when this browser or address cannot do passkeys', async () => {
    const { element } = await render({ supported: () => false });
    expect(element.querySelector('[data-testid="passkey-add"]')).toBeNull();
    expect(element.textContent).toContain('over HTTPS at its domain name');
  });

  it('turns on lock when closed', async () => {
    const { fixture, element, authService, notifications } = await render({});
    const toggle = element.querySelector('#lock-on-close') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    toggle.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(authService.setLockOnClose).toHaveBeenCalledWith(true);
    expect(notifications.success).toHaveBeenCalledWith('Locks when closed', expect.any(String));
  });
});
