import { DOCUMENT } from '@angular/common';
import { Injectable, Signal, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  // Versioned so a stale "light" saved under the old key (from before dark
  // was the default) doesn't keep overriding the dark default on open.
  private static readonly STORAGE_KEY = 'sp-theme-v2';

  private readonly document = inject(DOCUMENT);
  private readonly themeState = signal<ThemeMode>('dark');

  readonly theme: Signal<ThemeMode> = this.themeState.asReadonly();

  constructor() {
    this.initializeTheme();
  }

  toggleTheme(): void {
    this.setTheme(this.themeState() === 'dark' ? 'light' : 'dark');
  }

  setTheme(theme: ThemeMode): void {
    this.themeState.set(theme);
    this.persistTheme(theme);
    this.applyTheme(theme);
  }

  private initializeTheme(): void {
    const stored = this.readStoredTheme();
    const initialTheme = stored ?? 'dark';
    this.themeState.set(initialTheme);
    this.applyTheme(initialTheme);
  }

  private applyTheme(theme: ThemeMode): void {
    const root = this.document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  }

  private readStoredTheme(): ThemeMode | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const value = window.localStorage.getItem(ThemeService.STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  }

  private persistTheme(theme: ThemeMode): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(ThemeService.STORAGE_KEY, theme);
  }
}
