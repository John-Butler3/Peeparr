import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ScrollMemoryService } from './scroll-memory.service';

@Component({ template: '' })
class BlankPage {}

describe('ScrollMemoryService', () => {
  let router: Router;
  let scrollY = 0;
  let pageHeight = 5000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => pageHeight,
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(((x: number, y: number) => {
      scrollY = y;
    }) as typeof window.scrollTo);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'performer/:id', component: BlankPage },
          { path: 'scene/:id', component: BlankPage },
          { path: 'library', component: BlankPage },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    TestBed.inject(ScrollMemoryService).start();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function go(url: string) {
    await router.navigateByUrl(url);
    await vi.advanceTimersByTimeAsync(100);
  }

  it('returns to the same place on the previous page via its back link', async () => {
    await go('/performer/p1');
    scrollY = 1800;

    await go('/scene/s1?returnTo=%2Fperformer%2Fp1');
    expect(scrollY).toBe(0);

    await go('/performer/p1');
    expect(scrollY).toBe(1800);
  });

  it('keeps trying while the page loads its content', async () => {
    await go('/performer/p1');
    scrollY = 3000;
    await go('/scene/s1');

    pageHeight = 900; // just arrived back: content not loaded yet
    await router.navigateByUrl('/performer/p1');
    await vi.advanceTimersByTimeAsync(100);
    expect(scrollY).toBeLessThan(3000);

    pageHeight = 5000; // content arrived
    await vi.advanceTimersByTimeAsync(100);
    expect(scrollY).toBe(3000);
  });

  it('starts other pages at the top', async () => {
    await go('/performer/p1');
    scrollY = 1200;
    await go('/scene/s1');
    await go('/library');
    expect(scrollY).toBe(0);
  });
});
