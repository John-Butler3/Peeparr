import { describe, expect, it } from 'vitest';
import { toneOf } from './logo-contrast.directive';

// 10 pixels: `solid` of them opaque in the given grey, the rest transparent.
function pixels(solid: number, grey: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(10 * 4);
  for (let i = 0; i < 10; i++) {
    data.set([grey, grey, grey, i < solid ? 255 : 0], i * 4);
  }
  return data;
}

describe('toneOf', () => {
  it('calls a dark logo on a transparent background dark (shown on a light tile)', () => {
    expect(toneOf(pixels(4, 20))).toBe('dark');
  });

  it('calls a light logo on a transparent background light (shown on a dark tile)', () => {
    expect(toneOf(pixels(4, 240))).toBe('light');
  });

  it('calls a logo with its own background opaque', () => {
    expect(toneOf(pixels(10, 240))).toBe('opaque');
  });

  it('gives up on an empty image', () => {
    expect(toneOf(pixels(0, 0))).toBeNull();
  });
});
