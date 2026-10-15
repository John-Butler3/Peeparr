import { TestBed } from '@angular/core/testing';
import { DiscreetLogoService } from './discreet-logo.service';

describe('DiscreetLogoService', () => {
  afterEach(() => {
    window.localStorage.removeItem(DiscreetLogoService.STORAGE_KEY);
    document.documentElement.classList.remove('discreet-logo');
    TestBed.resetTestingModule();
  });

  it('switches the logo for this device and remembers it', () => {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = 'favicon.svg';
    document.head.appendChild(icon);
    const service = TestBed.inject(DiscreetLogoService);
    expect(service.enabled()).toBe(false);

    service.set(true);

    expect(document.documentElement.classList.contains('discreet-logo')).toBe(true);
    expect(window.localStorage.getItem(DiscreetLogoService.STORAGE_KEY)).toBe('1');
    expect(icon.getAttribute('href')).toBe('favicon-discreet.svg');

    service.set(false);
    expect(document.documentElement.classList.contains('discreet-logo')).toBe(false);
    expect(window.localStorage.getItem(DiscreetLogoService.STORAGE_KEY)).toBeNull();
    icon.remove();
  });

  it('switches the home-screen icon and web app manifest too', () => {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = 'manifest.webmanifest';
    const touchIcon = document.createElement('link');
    touchIcon.rel = 'apple-touch-icon';
    touchIcon.href = 'icons/apple-touch-icon.png';
    document.head.append(manifest, touchIcon);
    const service = TestBed.inject(DiscreetLogoService);

    service.set(true);
    expect(manifest.getAttribute('href')).toBe('manifest-discreet.webmanifest');
    expect(touchIcon.getAttribute('href')).toBe('icons/apple-touch-icon-discreet.png');

    service.set(false);
    expect(manifest.getAttribute('href')).toBe('manifest.webmanifest');
    expect(touchIcon.getAttribute('href')).toBe('icons/apple-touch-icon.png');
    manifest.remove();
    touchIcon.remove();
  });
});
