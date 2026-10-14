import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  SceneCardBodyDirective,
  SceneCardCenterActionDirective,
  SceneCardMediaFooterDirective,
  SceneCardPlaceholderDirective,
  SceneCardShellComponent,
  SceneCardShellItem,
  SceneCardShellLink,
  SceneCardTopRightDirective,
} from './scene-card-shell.component';

@Component({
  template: `
    <app-scene-card-shell
      [item]="item"
      [variant]="variant"
      [primaryLink]="primaryLink"
      [studioBadgeLink]="studioBadgeLink"
      [progressPercent]="progressPercent"
    >
      <div sceneCardPlaceholder class="placeholder-copy">Missing artwork</div>
      <span sceneCardTopRight class="top-right">Top Flag</span>
      <button sceneCardCenterAction class="center-action-test" type="button">Play</button>
      <div sceneCardMediaFooter class="media-footer-test">Footer copy</div>
      <div sceneCardBody class="body-test">Body copy</div>
    </app-scene-card-shell>
  `,
  imports: [
    SceneCardShellComponent,
    SceneCardTopRightDirective,
    SceneCardMediaFooterDirective,
    SceneCardCenterActionDirective,
    SceneCardBodyDirective,
    SceneCardPlaceholderDirective,
  ],
})
class SceneCardShellHostComponent {
  item: SceneCardShellItem = {
    title: 'Shared Shell Scene',
    imageUrl: null,
    cardImageUrl: null,
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: 'http://cdn.local/studio.jpg',
  };
  variant: 'default' | 'rail' = 'default';
  primaryLink: SceneCardShellLink = {
    kind: 'router',
    commands: ['/scene', 'scene-1'],
    queryParams: { returnTo: '/library' },
    ariaLabel: 'Open scene details for Shared Shell Scene',
  };
  studioBadgeLink: SceneCardShellLink = {
    kind: 'router',
    commands: ['/library'],
    queryParams: { studios: 'studio-1', studioNames: 'Studio One' },
    ariaLabel: 'Filter library by studio Studio One',
  };
  progressPercent: number | null = null;
}

describe('SceneCardShellComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the shared media shell, badge chrome, placeholder, and projected slots', async () => {
    await TestBed.configureTestingModule({
      imports: [SceneCardShellHostComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(SceneCardShellHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement.querySelector(
      'app-scene-card-shell',
    ) as HTMLElement | null;
    const primaryLink = fixture.nativeElement.querySelector(
      '.media-link-stretch',
    ) as HTMLAnchorElement | null;
    const studioBadgeLink = fixture.nativeElement.querySelector(
      '.studio-badge-link',
    ) as HTMLAnchorElement | null;

    expect(host?.classList.contains('scene-card-shell-variant-default')).toBe(true);
    expect(primaryLink?.getAttribute('href')).toContain('/scene/scene-1');
    expect(primaryLink?.getAttribute('href')).toContain('returnTo=%2Flibrary');
    expect(studioBadgeLink?.getAttribute('href')).toContain('/library');
    expect(studioBadgeLink?.getAttribute('href')).toContain('studios=studio-1');
    expect(fixture.nativeElement.querySelector('.placeholder-copy')?.textContent).toContain(
      'Missing artwork',
    );
    expect(fixture.nativeElement.querySelector('.top-right')?.textContent).toContain('Top Flag');
    expect(fixture.nativeElement.querySelector('.media-footer-test')?.textContent).toContain(
      'Footer copy',
    );
    expect(fixture.nativeElement.querySelector('.body-test')?.textContent).toContain('Body copy');
    expect(fixture.nativeElement.querySelector('.center-action-test')?.textContent).toContain(
      'Play',
    );
    expect(fixture.nativeElement.querySelector('.progress-track')).toBeNull();
  });

  it('renders a progress bar sized to the given percentage', async () => {
    await TestBed.configureTestingModule({
      imports: [SceneCardShellHostComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(SceneCardShellHostComponent);
    fixture.componentInstance.progressPercent = 67;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const progressTrack = fixture.nativeElement.querySelector(
      '.progress-track',
    ) as HTMLElement | null;
    const progressFill = fixture.nativeElement.querySelector(
      '.progress-fill',
    ) as HTMLElement | null;

    expect(progressTrack?.getAttribute('aria-valuenow')).toBe('67');
    expect(progressFill?.style.width).toBe('67%');
  });
});
