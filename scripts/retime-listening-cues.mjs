/**
 * Re-derive listening transcript cue start/end from the actual audio. Most days shipped with
 * fabricated round-number timings (0/3/6…), so the dictation "play phrase" cut phrases mid-word and
 * the transcript highlight drifted. For each listening section we detect silences (ffmpeg
 * silencedetect), then place the N-1 inter-cue boundaries by distributing the audio proportionally to
 * cue text length and snapping each boundary to the nearest speech onset (silence end). The story
 * days (already measured) are left alone unless --all is passed.
 *
 * Usage: node scripts/retime-listening-cues.mjs [--dry] [--all] [file ...]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const DAYS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'packs', 'dev-english-a2', 'days');
const MEDIA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'packs', 'dev-english-a2');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const all = args.includes('--all');
const explicit = args.filter((a) => !a.startsWith('--'));

const GAP = 0.12; // small lead-in so a boundary doesn't clip the first phoneme
const round = (n) => Math.round(n * 100) / 100;

function ffprobeDuration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  return parseFloat(out.trim());
}

/** Speech onsets = the END of each detected silence (excluding the final trailing silence).
 *  ffmpeg's silencedetect prints to stderr, so we read stderr, not stdout. */
function speechOnsets(file, duration) {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.2', '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  const out = res.stderr || '';
  const onsets = [];
  for (const m of out.matchAll(/silence_end:\s*([\d.]+)/g)) {
    const t = parseFloat(m[1]);
    if (t > 0.05 && t < duration - 0.05) onsets.push(t);
  }
  return onsets;
}

/** Choose `need` increasing onsets closest (least-squares) to the proportional `targets`. Every
 *  boundary lands on a real speech onset, so a cue is never split mid-word. null if too few onsets. */
function bestOnsetSubset(onsets, targets) {
  const need = targets.length;
  if (onsets.length < need) return null;
  let best = null, bestCost = Infinity;
  const combo = new Array(need);
  const rec = (start, k) => {
    if (k === need) {
      let cost = 0;
      for (let j = 0; j < need; j++) cost += (combo[j] - targets[j]) ** 2;
      if (cost < bestCost) { bestCost = cost; best = combo.slice(); }
      return;
    }
    for (let idx = start; idx <= onsets.length - (need - k); idx++) {
      combo[k] = onsets[idx];
      rec(idx + 1, k + 1);
    }
  };
  rec(0, 0);
  return best;
}

function retimeCues(cues, duration, onsets) {
  const lens = cues.map((c) => Math.max(1, (c.en || '').length));
  const total = lens.reduce((a, b) => a + b, 0);
  const targets = [];
  for (let i = 1; i < cues.length; i++) {
    const cum = lens.slice(0, i).reduce((a, b) => a + b, 0);
    targets.push((cum / total) * duration);
  }
  let fallbacks = 0;
  const chosen = bestOnsetSubset(onsets, targets);
  const starts = [0];
  for (let i = 0; i < targets.length; i++) {
    let b;
    if (chosen) {
      b = chosen[i];
    } else {
      // Not enough onsets: proportional split, kept strictly increasing.
      fallbacks++;
      b = Math.max(starts[i] + 0.3, targets[i]);
    }
    starts.push(round(Math.max(0, b - GAP)));
  }
  const cued = cues.map((c, i) => ({
    ...c,
    start: starts[i],
    end: round(i + 1 < cues.length ? starts[i + 1] : duration),
  }));
  return { cued, fallbacks };
}

function pickFiles() {
  if (explicit.length) return explicit.map((f) => (f.endsWith('.json') ? f : `${f}.json`));
  return readdirSync(DAYS).filter((f) => f.endsWith('.json'));
}

let changed = 0, skipped = 0;
const fallbackDays = [], sparseDays = [];
for (const name of pickFiles()) {
  const file = join(DAYS, basename(name));
  const day = JSON.parse(readFileSync(file, 'utf8'));
  let touched = false;
  for (const s of day.sections || []) {
    if (s.type !== 'listening' || !Array.isArray(s.transcript) || !s.transcript.length || !s.audio?.src) continue;
    // Skip already-measured (non-integer) unless --all.
    const fabricated = s.transcript.every((c) => Number.isInteger(c.start) && Number.isInteger(c.end));
    if (!fabricated && !all) { skipped++; continue; }
    const audio = join(MEDIA, s.audio.src);
    let duration, onsets;
    try {
      duration = ffprobeDuration(audio);
      onsets = speechOnsets(audio, duration);
    } catch (e) {
      console.error(`! ${name}: audio probe failed (${s.audio.src}) — ${e.message}`);
      continue;
    }
    const { cued: next, fallbacks } = retimeCues(s.transcript, duration, onsets);
    if (dry) {
      console.log(`\n${name}  dur=${round(duration)}  onsets=[${onsets.map(round).join(', ')}]`);
      next.forEach((c, i) => console.log(`  [${i}] ${s.transcript[i].start}-${s.transcript[i].end} -> ${c.start}-${c.end}  "${c.en}"`));
    }
    if (fallbacks) fallbackDays.push(`${name}(${fallbacks})`);
    if (onsets.length < s.transcript.length - 1) sparseDays.push(`${name}(onsets=${onsets.length}/cues=${s.transcript.length})`);
    s.transcript = next;
    touched = true;
  }
  if (touched) {
    changed++;
    if (!dry) writeFileSync(file, JSON.stringify(day, null, 2) + '\n');
  }
}
console.log(`\n${dry ? '[dry] ' : ''}days changed: ${changed}; sections skipped (already measured): ${skipped}`);
if (sparseDays.length) console.log(`sparse (fewer onsets than boundaries) [${sparseDays.length}]: ${sparseDays.join(' ')}`);
if (fallbackDays.length) console.log(`used fallback boundary (no onset within 0.75s) [${fallbackDays.length}]: ${fallbackDays.join(' ')}`);
