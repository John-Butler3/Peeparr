// iOS launch images for the home-screen app: what iOS shows the moment the
// app opens, before the page has loaded -- the dark background with the logo
// where the loading screen puts it (112 x 80 CSS px, in the middle). One per
// screen size (portrait), plus the discreet logo's.
//
//   node scripts/make-launch-images.mjs   (needs `sharp`: npm i --no-save sharp)
//
// Writes apps/sp-web/public/launch/ and prints the <link> tags for index.html.
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

// [CSS width, CSS height, pixel ratio]
const SCREENS = [
  [440, 956, 3], // iPhone 16/17 Pro Max
  [402, 874, 3], // iPhone 16/17 Pro, 17
  [420, 912, 3], // iPhone Air
  [430, 932, 3], // iPhone 14 Pro Max, 15/16 Plus, 15 Pro Max
  [393, 852, 3], // iPhone 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // iPhone 12/13 Pro Max, 14 Plus
  [390, 844, 3], // iPhone 12/13/14, 16e
  [375, 812, 3], // iPhone X/XS/11 Pro, 12/13 mini
  [414, 896, 3], // iPhone XS Max, 11 Pro Max
  [414, 896, 2], // iPhone XR, 11
  [414, 736, 3], // iPhone 8 Plus
  [375, 667, 2], // iPhone SE, 8
  [1032, 1376, 2], // iPad Pro 13"
  [1024, 1366, 2], // iPad Pro 12.9"
  [834, 1210, 2], // iPad Pro 11" (M4)
  [834, 1194, 2], // iPad Pro 11"
  [820, 1180, 2], // iPad Air, iPad 10th gen
  [744, 1133, 2], // iPad mini
  [768, 1024, 2], // older iPads
];

const LOGO_WIDTH = 112;
const out = "apps/sp-web/public/launch";
mkdirSync(out, { recursive: true });

const logos = {
  "": readFileSync("docs/assets/logo.svg", "utf8"),
  "-discreet": readFileSync("docs/assets/logo-discreet.svg", "utf8"),
};
const inner = (svg) =>
  svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const links = [];
for (const [width, height, ratio] of SCREENS) {
  for (const [suffix, logo] of Object.entries(logos)) {
    const w = width * ratio;
    const h = height * ratio;
    const scale = (LOGO_WIDTH * ratio) / 28;
    const x = (w - 28 * scale) / 2;
    const y = (h - 20 * scale) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<rect width="100%" height="100%" fill="#0f0f0f"/>
<g transform="translate(${x} ${y}) scale(${scale})">${inner(logo)}</g></svg>`;
    const file = `launch-${w}x${h}${suffix}.png`;
    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, palette: true })
      .toFile(`${out}/${file}`);
    if (!suffix) {
      links.push(
        `<link rel="apple-touch-startup-image" media="(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)" href="launch/${file}" />`,
      );
    }
  }
}
console.log(links.join("\n"));
