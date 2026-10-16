import { Component } from '@angular/core';
import { AccountSettingsSectionComponent } from '../../features/auth/account-settings-section.component';
import { RemoteAccessSettingsComponent } from '../../shared/remote-access/remote-access-settings.component';

@Component({
  selector: 'app-settings-account-page',
  imports: [RemoteAccessSettingsComponent, AccountSettingsSectionComponent],
  templateUrl: './settings-account-page.component.html',
  styleUrl: './settings-account-page.component.scss',
})
export class SettingsAccountPageComponent {}
