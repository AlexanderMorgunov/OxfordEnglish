/**
 * Build the Android launcher icon set from the app's own brand mark.
 *
 * The source is the PWA icon (`public/icons/app-512.png`) rather than new art, because the launcher
 * icon and the installed-web icon are the same product on the same home screen — two different
 * pictures there is two different apps to anyone glancing at it. What changes is the FRAMING: the
 * full-body robot is a smudge at 48dp and loses its antenna and feet to whatever mask the launcher
 * crops with, so the icon is its head, which survives both.
 *
 * Adaptive icons (API 26+) are a foreground drawable over a flat colour. The outer ring of that
 * drawable is cropped — circle, squircle, rounded square, launcher's choice — so the mark sits inside
 * the guaranteed-visible middle and nothing of it depends on the corners. Legacy square and round
 * icons are for older launchers, where nothing is behind the image, so those are drawn filled.
 *
 * Usage: node scripts/android-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

const SOURCE = 'public/icons/app-512.png';
const RES = 'android/app/src/main/res';

/** The head, framed in the 512px source: below the antenna's tip, above the arms. */
const CROP = { x: 110, y: 35, size: 300 };

/**
 * The source's own background, NOT the `--color-ink` token — they are close but not equal (#04030c vs
 * #12141c), and a near-match is worse than either: the legacy icon's square would read as a slightly
 * darker panel sitting on the adaptive background.
 */
const BACKGROUND = { r: 0x04, g: 0x03, b: 0x0c };

/** Adaptive foregrounds are 108dp with only the middle 72dp guaranteed; the mark keeps well inside. */
const MARK_RATIO = 0.62;

const ADAPTIVE = [
  { dir: 'mipmap-mdpi', size: 108 },
  { dir: 'mipmap-hdpi', size: 162 },
  { dir: 'mipmap-xhdpi', size: 216 },
  { dir: 'mipmap-xxhdpi', size: 324 },
  { dir: 'mipmap-xxxhdpi', size: 432 },
];

const LEGACY = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

const full = PNG.sync.read(readFileSync(SOURCE));

function crop({ x, y, size }) {
  const out = new PNG({ width: size, height: size });
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const si = (full.width * (row + y) + (col + x)) << 2;
      const di = (size * row + col) << 2;
      for (let k = 0; k < 4; k++) out.data[di + k] = full.data[si + k];
    }
  }
  return out;
}

/**
 * Box filter: every destination pixel averages the source pixels it covers.
 *
 * Nearest-neighbour is right for pixel art and wrong here — dropping pixels from a shaded render
 * eats the thin highlight along the head's top edge and leaves the eyes' glow stepped.
 */
function resize(src, size) {
  const out = new PNG({ width: size, height: size });
  const ratio = src.width / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (src.width * sy + sx) << 2;
          r += src.data[si];
          g += src.data[si + 1];
          b += src.data[si + 2];
          a += src.data[si + 3];
          n += 1;
        }
      }
      const di = (size * y + x) << 2;
      out.data[di] = Math.round(r / n);
      out.data[di + 1] = Math.round(g / n);
      out.data[di + 2] = Math.round(b / n);
      out.data[di + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Place a square image centred on a canvas, either transparent or filled with the brand background. */
function place(mark, size, fill) {
  const out = new PNG({ width: size, height: size, fill: true });
  if (fill) {
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = fill.r;
      out.data[i + 1] = fill.g;
      out.data[i + 2] = fill.b;
      out.data[i + 3] = 255;
    }
  }
  const offset = Math.round((size - mark.width) / 2);
  for (let y = 0; y < mark.height; y++) {
    for (let x = 0; x < mark.width; x++) {
      const si = (mark.width * y + x) << 2;
      const di = (out.width * (y + offset) + (x + offset)) << 2;
      for (let k = 0; k < 4; k++) out.data[di + k] = mark.data[si + k];
    }
  }
  return out;
}

function write(path, png) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

const head = crop(CROP);
let count = 0;

for (const { dir, size } of ADAPTIVE) {
  const mark = resize(head, Math.round(size * MARK_RATIO));
  write(`${RES}/${dir}/ic_launcher_foreground.png`, place(mark, size, null));
  count += 1;
}

for (const { dir, size } of LEGACY) {
  const filled = resize(head, size);
  write(`${RES}/${dir}/ic_launcher.png`, filled);
  write(`${RES}/${dir}/ic_launcher_round.png`, filled);
  count += 2;
}

const hex = `#${[BACKGROUND.r, BACKGROUND.g, BACKGROUND.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
mkdirSync(`${RES}/values`, { recursive: true });
writeFileSync(
  `${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`
);

console.log(`${SOURCE} → head ${CROP.size}px → ${count} icons, background ${hex}`);
