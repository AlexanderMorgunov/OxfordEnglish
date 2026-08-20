/**
 * One-off: transcode the public pack's WAV audio → mp3 (fixes B1 — the ~205 MB WAV precache).
 * mp3 (not opus/ogg) for universal playback incl. iOS Safari. Mono 64 kbps is ample for speech.
 *
 * Requires ffmpeg on PATH. Install first:
 *   winget install Gyan.FFmpeg      (Windows)   |   scoop install ffmpeg   |   choco install ffmpeg
 *
 * Run from the repo root:  node tools/transcode-audio.mjs
 * Then:  npm run validate:packs   (should pass)   and commit.
 *
 * It (1) transcodes every media/audio/*.wav → .mp3, (2) rewrites every ".wav" ref in the day
 * JSON + course.json to ".mp3", (3) deletes the WAV originals. Idempotent-ish: re-running only
 * re-encodes whatever .wav remain.
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PACK = 'public/packs/dev-english-a2';
const AUDIO = join(PACK, 'media/audio');
// Absolute path wins over PATH (a freshly winget-installed ffmpeg isn't on an already-open shell's
// PATH). Pass FFMPEG=... to override.
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

try {
  execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
} catch {
  console.error(`ffmpeg not runnable ("${FFMPEG}"). Install it or pass FFMPEG=<path>. See header.`);
  process.exit(1);
}

const wavs = readdirSync(AUDIO).filter((f) => f.endsWith('.wav'));
if (wavs.length === 0) {
  console.log('No .wav files left — nothing to transcode.');
}

const sizeMB = (dir, ext) =>
  (readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .reduce((s, f) => s + statSync(join(dir, f)).size, 0) /
    1e6).toFixed(1);

const wavBefore = sizeMB(AUDIO, '.wav');
console.log(`transcoding ${wavs.length} wav → mp3 (${wavBefore} MB of wav)…`);

let done = 0;
for (const w of wavs) {
  const inp = join(AUDIO, w);
  const out = join(AUDIO, w.replace(/\.wav$/, '.mp3'));
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', inp, '-ac', '1', '-b:a', '64k', out]);
  if (++done % 100 === 0 || done === wavs.length) console.log(`  ${done}/${wavs.length}`);
}

const files = [
  ...readdirSync(join(PACK, 'days')).map((f) => join(PACK, 'days', f)),
  join(PACK, 'course.json'),
];
let refs = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  const matches = before.match(/media\/audio\/[^"]+\.wav/g) ?? [];
  if (matches.length === 0) continue;
  writeFileSync(f, before.replace(/(media\/audio\/[^"]+)\.wav/g, '$1.mp3'));
  refs += matches.length;
}
console.log(`rewrote ${refs} audio refs (.wav → .mp3)`);

for (const w of wavs) rmSync(join(AUDIO, w));
console.log(`deleted ${wavs.length} wav originals`);
console.log(`mp3 total now: ${sizeMB(AUDIO, '.mp3')} MB (was ${wavBefore} MB of wav)`);
console.log('Done. Run `npm run validate:packs`, then commit.');
