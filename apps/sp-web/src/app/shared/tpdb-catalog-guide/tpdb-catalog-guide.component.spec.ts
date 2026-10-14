import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TpdbCatalogGuideComponent } from './tpdb-catalog-guide.component';

describe('TpdbCatalogGuideComponent', () => {
  it("explains the token and the Whisparr-Eros switch, with this Peeparr's address in the command", async () => {
    await TestBed.configureTestingModule({
      imports: [TpdbCatalogGuideComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(TpdbCatalogGuideComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('ThePornDB API token');
    expect(element.textContent).toContain('Point Whisparr-Eros at Peeparr');
    const command = element.querySelector('pre')?.textContent ?? '';
    expect(command).toContain('scripts/configure-eros.sh');
    expect(command).toContain(`--catalog tpdb --peeparr-url ${window.location.origin}`);
  });
});
