import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';

/** A network and its studios, as search results. */
export interface StudioPickerGroup {
  label: string;
  items: ReadonlyArray<{ label: string; value: string }>;
}

/**
 * Choosing studios to filter by: one box you type straight into (tapping
 * it brings the keyboard up), the matches listed just below it -- over the
 * page, not in a pop-up, so the keyboard coming up can't close them -- and
 * what's chosen shown as chips in the box. The page does the searching.
 */
@Component({
  selector: 'app-studio-picker',
  templateUrl: './studio-picker.component.html',
  styleUrl: './studio-picker.component.scss',
})
export class StudioPickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  @Input() inputId = '';
  @Input() placeholder = 'Search studios';
  @Input() selected: ReadonlyArray<{ id: string; label: string }> = [];
  @Input() groups: readonly StudioPickerGroup[] = [];
  @Input() loading = false;
  /** Shown when a search finds nothing (or fails). */
  @Input() emptyMessage = 'No studios found.';

  @Output() queryChange = new EventEmitter<string>();
  @Output() selectedIdsChange = new EventEmitter<string[]>();

  @ViewChild('input', { static: true }) private input!: ElementRef<HTMLInputElement>;

  protected readonly query = signal('');
  protected readonly open = signal(false);

  protected isSelected(id: string): boolean {
    return this.selected.some((studio) => studio.id === id);
  }

  protected toggle(id: string): void {
    const ids = this.selected.map((studio) => studio.id);
    this.selectedIdsChange.emit(
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
    // Picked: the search is done with (the box is ready for the next one).
    this.onInput('');
  }

  protected remove(id: string, event: Event): void {
    event.stopPropagation();
    this.selectedIdsChange.emit(
      this.selected.map((studio) => studio.id).filter((value) => value !== id),
    );
    this.input.nativeElement.focus();
  }

  /** Unpicks every studio. */
  protected clearSelection(event: Event): void {
    event.stopPropagation();
    this.selectedIdsChange.emit([]);
    // Its button goes: the typing carries on in the box.
    this.input.nativeElement.focus();
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.open.set(true);
    this.queryChange.emit(value);
  }

  protected clearQuery(): void {
    this.onInput('');
    this.input.nativeElement.focus();
  }

  /** Taps anywhere in the box type into it. */
  protected focusInput(): void {
    this.input.nativeElement.focus();
  }

  protected onFocusOut(): void {
    // Still in here (a chip's remove button, say): stays open.
    setTimeout(() => {
      if (!this.host.contains(document.activeElement)) {
        this.open.set(false);
      }
    });
  }

  protected onEscape(): void {
    this.open.set(false);
    this.input.nativeElement.blur();
  }

  /** Choosing a match keeps the focus (and the keyboard) in the box. */
  protected keepFocus(event: Event): void {
    event.preventDefault();
  }

  protected showResults(): boolean {
    return this.open() && (this.query().trim().length > 0 || this.loading);
  }

  protected hasMatches(): boolean {
    return this.groups.some((group) => group.items.length > 0);
  }
}
