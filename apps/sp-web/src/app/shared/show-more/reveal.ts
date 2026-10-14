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
