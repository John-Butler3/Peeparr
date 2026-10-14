import { describe, expect, it } from 'vitest';
import { Reveal } from './reveal';

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
