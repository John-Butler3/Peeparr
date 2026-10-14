import { Directive, ElementRef, HostListener, inject } from '@angular/core';

export type LogoTone = 'dark' | 'light' | 'opaque';

/**
 * On a studio logo <img>: once it loads, samples it to pick the background
 * that shows it best, and sets `data-logo-tone` on the logo's tile (the
 * img's parent):
 * - `dark`: a dark logo on a transparent background -> light tile
 * - `light`: a light logo on a transparent background -> dark tile
 * - `opaque`: the logo brings its own background -> no tile colour
 * Logos from other sites that can't be read (no CORS) keep the tile's
 * default.
 */
@Directive({
  selector: 'img[appLogoContrast]',
})
export class LogoContrastDirective {
  private readonly img = inject<ElementRef<HTMLImageElement>>(ElementRef).nativeElement;

  @HostListener('load')
  protected onLoad(): void {
    const tone = logoTone(this.img);
    const tile = this.img.parentElement;
    if (tone) {
      tile?.setAttribute('data-logo-tone', tone);
    } else {
      tile?.removeAttribute('data-logo-tone');
    }
  }
}

const SAMPLE = 32;

export function logoTone(img: HTMLImageElement): LogoTone | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  let pixels: Uint8ClampedArray;
  try {
    context.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    pixels = context.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }
  return toneOf(pixels);
}

/** Works out the tone from RGBA pixel data. */
export function toneOf(pixels: Uint8ClampedArray): LogoTone | null {
  let opaque = 0;
  let luminance = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]! / 255;
    if (alpha < 0.5) {
      continue;
    }
    opaque += 1;
    luminance +=
      (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
  }

  if (count === 0 || opaque === 0) {
    return null;
  }
  // Nearly every pixel solid: the logo has its own background.
  if (opaque / count > 0.92) {
    return 'opaque';
  }
  return luminance / opaque > 0.55 ? 'light' : 'dark';
}
