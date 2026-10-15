import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NavigationHistoryService } from '../../core/navigation/navigation-history.service';
import { BackLinkDirective } from './back-link.directive';

@Component({ template: '' })
class BlankComponent {}

@Component({
  imports: [BackLinkDirective],
  template: `<a appBackLink="/performers" [backQueryParams]="{ page: 2 }">Back</a>`,
})
class HostComponent {}

describe('BackLinkDirective', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([{ path: '**', component: BlankComponent }]), provideLocationMocks()],
    });
    router = TestBed.inject(Router);
    TestBed.inject(NavigationHistoryService);
    router.initialNavigation();
  });

  afterEach(() => TestBed.resetTestingModule());

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  function link(): HTMLAnchorElement {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('a');
  }

  it('links to its fallback page', () => {
    expect(link().getAttribute('href')).toBe('/performers?page=2');
  });

  it('goes back through history, without also navigating to the link', async () => {
    await router.navigateByUrl('/upcoming');
    await router.navigateByUrl('/performer/p1');
    const navigate = vi.spyOn(router, 'navigateByUrl');

    link().click();
    await settle();

    expect(router.url).toBe('/upcoming');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes to the fallback with no in-app history', async () => {
    await router.navigateByUrl('/performer/p1');

    link().click();
    await settle();

    expect(router.url).toBe('/performers?page=2');
  });
});
