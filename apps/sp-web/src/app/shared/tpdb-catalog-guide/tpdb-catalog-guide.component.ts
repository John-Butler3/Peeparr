import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * How to use ThePornDB as the catalog: the API token, pointing Whisparr-Eros
 * at Peeparr's ThePornDB metadata proxy (scripts/configure-eros.sh, with this
 * Peeparr's address filled in), and the optional website login for Popular.
 */
@Component({
  selector: 'app-tpdb-catalog-guide',
  imports: [RouterLink],
  templateUrl: './tpdb-catalog-guide.component.html',
  styleUrl: './tpdb-catalog-guide.component.scss',
})
export class TpdbCatalogGuideComponent {
  static readonly SCRIPT_URL =
    'https://raw.githubusercontent.com/John-Butler3/Peeparr/main/scripts/configure-eros.sh';
  static readonly DOCS_URL =
    'https://github.com/John-Butler3/Peeparr/blob/main/docs/DEPLOYMENT.md';

  protected readonly docsUrl = TpdbCatalogGuideComponent.DOCS_URL;
  /** This Peeparr's address as the browser sees it (Whisparr must reach it). */
  protected readonly peeparrUrl = signal(typeof window === 'undefined' ? 'http://<peeparr>:3000' : window.location.origin);
  protected readonly command = computed(
    () =>
      `curl -fsSLO ${TpdbCatalogGuideComponent.SCRIPT_URL}\n` +
      `bash configure-eros.sh --catalog tpdb --peeparr-url ${this.peeparrUrl()}`,
  );
  protected readonly copied = signal(false);

  protected copyCommand(): void {
    void navigator.clipboard?.writeText(this.command()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
