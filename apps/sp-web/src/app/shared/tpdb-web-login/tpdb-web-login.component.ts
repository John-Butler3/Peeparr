import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonDirective } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { switchMap } from 'rxjs';
import { TpdbWebService, TpdbWebStatus } from '../../core/api/tpdb-web.service';

/**
 * Settings card for the optional ThePornDB website login: Peeparr signs in
 * to read the site's members-only popular scenes (shown first on Home and
 * Scenes). The website is checked at most every few hours.
 */
@Component({
  selector: 'app-tpdb-web-login',
  imports: [ReactiveFormsModule, ButtonDirective, InputText, Message, DatePipe],
  templateUrl: './tpdb-web-login.component.html',
  styleUrl: './tpdb-web-login.component.scss',
})
export class TpdbWebLoginComponent implements OnInit {
  private readonly tpdbWebService = inject(TpdbWebService);

  protected readonly status = signal<TpdbWebStatus | null>(null);
  protected readonly busy = signal<'save' | 'test' | 'remove' | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    this.tpdbWebService.getStatus().subscribe({
      next: (status) => this.applyStatus(status),
      error: () => this.error.set('Could not load the TPDB website login.'),
    });
  }

  // Saves, then signs in and reads the homepage straight away.
  protected save(): void {
    const { email, password } = this.form.getRawValue();
    if (!email.trim() || (!password && !this.status()?.configured)) {
      this.error.set('Enter your TPDB website email and password.');
      return;
    }

    this.error.set(null);
    this.busy.set('save');
    this.tpdbWebService
      .save(email, password || null)
      .pipe(switchMap(() => this.tpdbWebService.refresh()))
      .subscribe({
        next: (status) => {
          this.busy.set(null);
          this.applyStatus(status);
        },
        error: () => {
          this.busy.set(null);
          this.error.set('Could not save the TPDB website login.');
        },
      });
  }

  protected test(): void {
    this.error.set(null);
    this.busy.set('test');
    this.tpdbWebService.refresh().subscribe({
      next: (status) => {
        this.busy.set(null);
        this.applyStatus(status);
      },
      error: () => {
        this.busy.set(null);
        this.error.set('Could not reach Peeparr.');
      },
    });
  }

  protected remove(): void {
    this.busy.set('remove');
    this.tpdbWebService.remove().subscribe({
      next: () => {
        this.busy.set(null);
        this.form.reset();
        this.status.set({
          configured: false,
          email: null,
          popularCount: 0,
          popularPerformerCount: 0,
          popularSiteCount: 0,
          popularFetchedAt: null,
          lastAttemptAt: null,
          lastError: null,
          sourcePath: null,
          performerSourcePath: null,
          siteSourcePath: null,
        });
      },
      error: () => this.busy.set(null),
    });
  }

  private applyStatus(status: TpdbWebStatus): void {
    this.status.set(status);
    this.form.controls.email.setValue(status.email ?? '');
    this.form.controls.password.setValue('');
  }
}
