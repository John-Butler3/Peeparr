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
});
