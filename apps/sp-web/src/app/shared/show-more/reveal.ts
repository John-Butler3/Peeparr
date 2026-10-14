import { signal } from '@angular/core';

/** A list shown a few at a time: the first `first`, then `step` more per "Show more". */
export class Reveal {
  readonly shown = signal(0);

  constructor(
    private readonly first: number,
    private readonly step: number,
  ) {
    this.shown.set(first);
  }

  slice<T>(items: readonly T[]): T[] {
    return items.slice(0, this.shown());
  }

  hasMore(count: number): boolean {
    return count > this.shown();
  }

  more(): void {
    this.shown.update((shown) => shown + this.step);
  }

  reset(): void {
    this.shown.set(this.first);
  }
}

/**
 * Tiles shown a row at a time: `firstRows` rows at first, then `stepRows`
 * more per "Show more" (however many tiles fit in a row).
 */
export class RowReveal {
  readonly rows = signal(0);

  constructor(
    private readonly firstRows: number,
    private readonly stepRows: number,
  ) {
    this.rows.set(firstRows);
  }

  slice<T>(items: readonly T[], perRow: number): T[] {
    return items.slice(0, this.rows() * perRow);
  }

  hasMore(count: number, perRow: number): boolean {
    return count > this.rows() * perRow;
  }

  more(): void {
    this.rows.update((rows) => rows + this.stepRows);
  }

  reset(): void {
    this.rows.set(this.firstRows);
  }
}

/**
 * How many tiles fit in a row: 4 on phones and narrow screens, 6 on mid-size,
 * 8 on wide screens. Updates as the window changes.
 */
export function tilesPerRow(): () => number {
  const perRow = signal(4);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return perRow.asReadonly();
  }
  const wide = window.matchMedia('(min-width: 1500px)');
  const mid = window.matchMedia('(min-width: 1000px)');
  const update = () => perRow.set(wide.matches ? 8 : mid.matches ? 6 : 4);
  update();
  wide.addEventListener?.('change', update);
  mid.addEventListener?.('change', update);
  return perRow.asReadonly();
}
