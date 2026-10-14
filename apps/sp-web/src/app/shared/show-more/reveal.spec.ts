import { describe, expect, it } from 'vitest';
import { Reveal, RowReveal } from './reveal';

describe('Reveal', () => {
  it('shows the first few, more on request, and starts over on reset', () => {
    const reveal = new Reveal(4, 8);
    const items = Array.from({ length: 15 }, (_, i) => i);

    expect(reveal.slice(items)).toEqual([0, 1, 2, 3]);
    expect(reveal.hasMore(items.length)).toBe(true);

    reveal.more();
    expect(reveal.slice(items).length).toBe(12);
    reveal.more();
    expect(reveal.slice(items).length).toBe(15);
    expect(reveal.hasMore(items.length)).toBe(false);

    reveal.reset();
    expect(reveal.slice(items).length).toBe(4);
  });
});

describe('RowReveal', () => {
  it('shows one row of however many fit, then two more rows at a time', () => {
    const reveal = new RowReveal(1, 2);
    const items = Array.from({ length: 30 }, (_, i) => i);

    expect(reveal.slice(items, 4)).toEqual([0, 1, 2, 3]);
    expect(reveal.slice(items, 8).length).toBe(8);

    reveal.more();
    expect(reveal.slice(items, 6).length).toBe(18);
    expect(reveal.hasMore(items.length, 6)).toBe(true);
    reveal.more();
    expect(reveal.hasMore(items.length, 6)).toBe(false);

    reveal.reset();
    expect(reveal.slice(items, 4).length).toBe(4);
  });
});
