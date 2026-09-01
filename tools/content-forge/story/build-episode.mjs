/**
 * Generalized Office-Stories episode builder: a plain-text episode spec (the JSON a model/author
 * fills) → a full learning-day pack file (Piper audio + measured dictation timings + optional
 * illustrations), inserted safely into a grammar unit.
 *
 *   FFMPEG=<abs> node tools/content-forge/story/build-episode.mjs <spec.json> [--dry]
 *   --dry: build the Day and print it (Zod-validated by validate:packs later), do NOT write/register.
 *
 * Spec shape (see specs/*.json; text fields are what DeepSeek produces, meta is authored):
 *   { id:"u11.d90", unitId:"u11", insertAt:2, tags:[...],
 *     title:{en,ru},
 *     vocab:[{word,ru,ipa,example,exampleRu}, ...],
 *     grammar:{title:{en,ru}, ref, rule:{en,ru}, patterns:[{label:{en,ru},formula,examples:[{en,ru}],ref}], pitfalls:[{en,ru}]},
 *     reading:{title:{en,ru}, blocks:[{en,ru,image?:"b1"}], glossary:[{word,ru,ipa}]},
 *     listening:{title:{en,ru}, dialogue:[["en","ru"], ...], exercises:[<Exercise>]},
 *     practice:{exercises:[<Exercise>, ...]} }
 * Images: a block's `image:"b1"` maps to media/images/<id>.reading.b1.png IF that file exists
 * (text ships without art; illustrations are added separately). No `level` field — story days stay
 * out of the level-exit test.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const PACK = 'public/packs/dev-english-a2';
const AUDIO = join(PACK, 'media/audio');
const IMAGES = join(PACK, 'media/images');
const PIPER = 'tools/content-forge/vendor/piper/piper.exe';
const VOICE = 'tools/content-forge/vendor/voices/en_US-lessac-medium.onnx';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const LIC = { type: 'original', attribution: 'Project authors (LLM-assisted)' };
const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function synth(text, name) {
  const wav = join(AUDIO, `${name}.wav`), mp3 = join(AUDIO, `${name}.mp3`);
  execFileSync(PIPER, ['-m', VOICE, '-f', wav], { input: text });
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-b:a', '64k', mp3]);
  rmSync(wav);
  return { src: `media/audio/${name}.mp3`, license: LIC };
}
const durationOf = (wav) =>
  parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());
function synthDialogue(lines, base) {
  const wavs = [], cues = [];
  let t = 0;
  lines.forEach(([en, ru], i) => {
    const wav = join(AUDIO, `${base}.part${i}.wav`);
    execFileSync(PIPER, ['-m', VOICE, '-f', wav], { input: en });
    const d = durationOf(wav);
    cues.push({ start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100, en, ru });
    t += d;
    wavs.push(wav);
  });
  const listFile = join(AUDIO, `${base}.concat.txt`);
  writeFileSync(listFile, lines.map((_, i) => `file '${base}.part${i}.wav'`).join('\n'));
  const mp3 = join(AUDIO, `${base}.mp3`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-ac', '1', '-b:a', '64k', mp3]);
  wavs.forEach((w) => rmSync(w));
  rmSync(listFile);
  return { audio: { src: `media/audio/${base}.mp3`, license: LIC }, cues };
}

function buildDay(spec, dry) {
  const D = spec.id;
  const speak = dry ? () => ({ src: `media/audio/${D}.stub.mp3`, license: LIC }) : synth;
  const speakDialogue = dry
    ? (lines, base) => ({
        audio: { src: `media/audio/${base}.mp3`, license: LIC },
        cues: lines.map(([en, ru], i) => ({ start: i, end: i + 1, en, ru })),
      })
    : synthDialogue;

  const vocab = {
    type: 'vocabulary',
    id: `${D}.vocab`,
    title: spec.vocab.title ?? { en: 'Vocabulary', ru: 'Лексика' },
    words: spec.vocab.words.map((w) => ({
      word: w.word, ru: w.ru, ipa: w.ipa, example: w.example, exampleRu: w.exampleRu,
      audio: speak(w.word.replace(/^to /, ''), `${D}.vocab.${sanitize(w.word)}`),
    })),
  };

  const reading = {
    type: 'reading',
    id: `${D}.reading`,
    title: spec.reading.title,
    blocks: spec.reading.blocks.map((b, i) => {
      const id = `${D}.reading.b${i + 1}`;
      const out = { id, en: b.en, ru: b.ru, audio: speak(b.en, id) };
      if (b.image) {
        const rel = `media/images/${D}.reading.${b.image}.png`;
        if (existsSync(join(IMAGES, `${D}.reading.${b.image}.png`))) {
          out.image = { src: rel, license: LIC, alt: b.alt ?? { en: reading.title?.en ?? '', ru: '' } };
        }
      }
      return out;
    }),
    glossary: spec.reading.glossary ?? [],
  };

  const dlg = speakDialogue(spec.listening.dialogue, `${D}.listening`);
  const listening = {
    type: 'listening',
    id: `${D}.listening`,
    title: spec.listening.title,
    audio: dlg.audio,
    transcript: dlg.cues,
    exercises: spec.listening.exercises,
  };

  const practice = {
    type: 'practice',
    id: `${D}.practice`,
    title: { en: 'Practice', ru: 'Практика' },
    exercises: spec.practice.exercises,
  };

  return {
    id: D,
    title: spec.title,
    // Opt-in only: story specs never carry `level` (they must stay out of the level-exit test), so this
    // is inert for them; leveled days (e.g. the A1 on-ramp) set it to enter placement / exit-test sampling.
    ...(spec.level ? { level: spec.level } : {}),
    estimatedMinutes: spec.estimatedMinutes ?? 90,
    tags: spec.tags,
    sections: [vocab, { type: 'grammar', id: `${D}.grammar`, ...spec.grammar }, reading, listening, practice],
  };
}

function register(spec) {
  const coursePath = join(PACK, 'course.json');
  const course = JSON.parse(readFileSync(coursePath, 'utf8'));
  const u = course.units.find((x) => x.id === spec.unitId);
  if (!u) throw new Error(`unit ${spec.unitId} not found`);
  if (!u.dayIds.includes(spec.id)) {
    const at = Math.min(spec.insertAt ?? 2, u.dayIds.length);
    u.dayIds.splice(at, 0, spec.id);
    writeFileSync(coursePath, JSON.stringify(course, null, 2) + '\n');
    console.log(`Registered ${spec.id} in ${spec.unitId} at position ${at}.`);
  } else {
    console.log(`${spec.id} already registered.`);
  }
}

const specPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!specPath) {
  console.error('usage: node build-episode.mjs <spec.json> [--dry]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const day = buildDay(spec, dry);
if (dry) {
  console.log(JSON.stringify(day, null, 2));
} else {
  writeFileSync(join(PACK, 'days', `${spec.id}.json`), JSON.stringify(day, null, 2) + '\n');
  register(spec);
  console.log('Built', spec.id, 'OK');
}
