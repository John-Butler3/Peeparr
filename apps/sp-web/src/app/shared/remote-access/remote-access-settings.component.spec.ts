import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NetworkSettings, NetworkSettingsService } from '../../core/api/network-settings.service';
import { RemoteAccessSettingsComponent } from './remote-access-settings.component';

describe('RemoteAccessSettingsComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(initial: Partial<NetworkSettings> = {}) {
    const settings: NetworkSettings = {
      trustProxy: null,
      effectiveTrustProxy: null,
      lockedByEnvironment: false,
      connectedThroughProxy: false,
      ...initial,
    };
    const service = {
      get: vi.fn().mockReturnValue(of(settings)),
      update: vi.fn((trustProxy: string | null) =>
        of({ ...settings, trustProxy, effectiveTrustProxy: trustProxy }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [RemoteAccessSettingsComponent],
      providers: [{ provide: NetworkSettingsService, useValue: service }],
    });
    const fixture = TestBed.createComponent(RemoteAccessSettingsComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const radio = (index: number) => element.querySelectorAll<HTMLInputElement>('input[type="radio"]')[index];
    const save = () => element.querySelector<HTMLButtonElement>('.save');
    return { fixture, element, service, radio, save };
  }

  it('saves "through a reverse proxy" as one trusted hop', () => {
    const { fixture, element, service, radio, save } = render();

    expect(radio(0).checked).toBe(true);
    expect(save()?.disabled).toBe(true);

    radio(1).click();
    fixture.detectChanges();
    save()!.click();
    fixture.detectChanges();

    expect(service.update).toHaveBeenCalledWith('1');
    expect(element.textContent).toContain('Peeparr now trusts your proxy');
  });

  it('takes a specific proxy address, and asks for one if empty', () => {
    const { fixture, element, service, radio, save } = render();

    radio(2).click();
    fixture.detectChanges();
    save()!.click();
    fixture.detectChanges();
    expect(service.update).not.toHaveBeenCalled();
    expect(element.querySelector('.error')?.textContent).toContain("proxy's address");

    const address = element.querySelector<HTMLInputElement>('.address')!;
    address.value = '10.0.0.2';
    address.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    save()!.click();

    expect(service.update).toHaveBeenCalledWith('10.0.0.2');
  });

  it('points out an untrusted proxy you are using right now', () => {
    const { element } = render({ connectedThroughProxy: true });
    expect(element.querySelector('[data-testid="remote-access-proxy-hint"]')).toBeTruthy();
  });

  it('is read-only when set on the server', () => {
    const { element, radio, save } = render({ lockedByEnvironment: true, effectiveTrustProxy: '1' });
    expect(radio(1).checked).toBe(true);
    expect(radio(0).disabled).toBe(true);
    expect(save()).toBeNull();
    expect(element.textContent).toContain('PEEPARR_TRUST_PROXY');
  });
});
