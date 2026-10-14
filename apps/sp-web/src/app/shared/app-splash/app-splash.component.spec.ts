import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppSplashComponent, setNextAppSplash } from './app-splash.component';
import { dismissBootSplash } from './boot-splash';

describe('AppSplashComponent', () => {
  let stable: () => void;
  let splash: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
    splash = document.createElement('div');
    splash.id = 'boot-splash';
    document.body.appendChild(splash);
    await TestBed.configureTestingModule({ imports: [AppSplashComponent] }).compileComponents();
    vi.spyOn(TestBed.inject(ApplicationRef), 'whenStable').mockReturnValue(
      new Promise<void>((resolve) => (stable = resolve)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setNextAppSplash(null);
    splash.remove();
    TestBed.resetTestingModule();
  });

  function render() {
    const fixture = TestBed.createComponent(AppSplashComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('waits with the logo in place until the page has loaded, then reveals and hides it', async () => {
    setNextAppSplash('reveal');
    render();
    vi.advanceTimersByTime(1000);
    expect(splash.classList).not.toContain('is-revealing');

    stable();
    await vi.advanceTimersByTimeAsync(1);
    expect(splash.classList).toContain('is-revealing');
    expect(Number(document.documentElement.style.getPropertyValue('--splash-scale-end'))).toBeGreaterThan(1);

    vi.advanceTimersByTime(AppSplashComponent.REVEAL_MS);
    expect(splash.hidden).toBe(true);
    expect(splash.classList).not.toContain('is-revealing');
  });

  it('shows the same splash again after signing in', async () => {
    splash.hidden = true;
    setNextAppSplash('reveal');
    render();
    expect(splash.hidden).toBe(false);
  });

  it("doesn't wait forever on a slow page", async () => {
    setNextAppSplash('reveal');
    render();
    await vi.advanceTimersByTimeAsync(AppSplashComponent.MAX_WAIT_MS);
    expect(splash.classList).toContain('is-revealing');
  });

  it('leaves the splash alone when no splash was asked for', () => {
    setNextAppSplash(null);
    render();
    expect(splash.dataset['taken']).toBeUndefined();
  });

  it('fades the splash away on pages that are not the app shell', () => {
    dismissBootSplash();
    expect(splash.classList).toContain('is-dismissing');
    vi.advanceTimersByTime(300);
    expect(splash.hidden).toBe(true);
  });
});
