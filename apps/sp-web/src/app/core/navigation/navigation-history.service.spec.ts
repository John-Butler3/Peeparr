import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NavigationHistoryService } from './navigation-history.service';

@Component({ template: '' })
class BlankComponent {}

describe('NavigationHistoryService', () => {
  let router: Router;
  let history: NavigationHistoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideLocationMocks(),
      ],
    });
    router = TestBed.inject(Router);
    history = TestBed.inject(NavigationHistoryService);
    // Starts listening for Back/Forward, as the app does on load.
    router.initialNavigation();
  });

  afterEach(() => TestBed.resetTestingModule());

  // Back/Forward settle asynchronously through the router.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('falls back with no in-app history', async () => {
    await router.navigateByUrl('/scene/1');

    expect(history.canGoBack()).toBe(false);
    expect(history.backLabel('Back to Scenes')).toBe('Back to Scenes');
    expect(history.back()).toBe(false);
  });

  it('names the screen you came from, by path or by the name it gave itself', async () => {
    await router.navigateByUrl('/upcoming');
    await router.navigateByUrl('/scene/1');
    expect(history.backLabel('Back to Scenes')).toBe('Back to Upcoming');

    history.setLabel('Lakeside Afternoon');
    await router.navigateByUrl('/performer/p1');
    expect(history.backLabel('Back to Performers')).toBe('Back to Lakeside Afternoon');
  });

  it('shortens long names', async () => {
    await router.navigateByUrl('/scene/1');
    history.setLabel('Weekend Getaway — Chapter 1 With A Much Longer Title');
    await router.navigateByUrl('/studio/s1');

    expect(history.backLabel('x')).toBe('Back to Weekend Getaway — Chapter 1…');
  });

  it('treats filter changes as the same screen', async () => {
    await router.navigateByUrl('/home');
    await router.navigateByUrl('/scenes');
    await router.navigateByUrl('/scenes?sort=DATE');
    await router.navigateByUrl('/scene/1');

    expect(history.backLabel('x')).toBe('Back to Scenes');
    expect(history.previous()?.url).toBe('/scenes?sort=DATE');
  });

  it('follows Back through the history', async () => {
    await router.navigateByUrl('/home');
    await router.navigateByUrl('/scene/1');
    history.setLabel('Lakeside Afternoon');
    await router.navigateByUrl('/performer/p1');

    expect(history.back()).toBe(true);
    await settle();
    expect(router.url).toBe('/scene/1');
    expect(history.backLabel('x')).toBe('Back to Home');

    history.back();
    await settle();
    expect(router.url).toBe('/home');
    expect(history.canGoBack()).toBe(false);
  });
});
