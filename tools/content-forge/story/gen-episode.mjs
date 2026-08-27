/**
 * Generate an Office-Stories episode spec with DeepSeek from a short brief. The model writes only
 * the leveled TEXT (vocab/grammar/reading/dialogue/practice) into the spec schema; audio and art are
 * added later by build-episode.mjs. Review + level-check the spec before building.
 *
 *   node tools/content-forge/story/gen-episode.mjs <brief.json>
 *   → writes tools/content-forge/story/specs/<id>.json
 *
 * Needs DEEPSEEK_API_KEY in .env (never printed). Model via DEEPSEEK_MODEL (default deepseek-chat).
 *
 * Brief shape:
 *   { id, unitId, insertAt?, tags:[...], level:"A2"|"B1",
 *     episode:"The 8 AM Call", grammarName:{en,ru}, grammarRef:"...",
 *     scenario:"one-paragraph plot in English", characters:["Kate","David"] }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');

function envKey(name) {
  const raw = readFileSync(join(ROOT, '.env'), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith(`${name}=`));
  const v = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  if (!v) throw new Error(`${name} missing in .env`);
  return v;
}

const briefPath = process.argv[2];
if (!briefPath) {
  console.error('usage: node gen-episode.mjs <brief.json>');
  process.exit(1);
}
const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
const bible = readFileSync(join(HERE, 'bible.md'), 'utf8');
const example = readFileSync(join(HERE, 'specs/u04.d90.json'), 'utf8');

const RULES = `
You write ONE episode of "Office Stories" (English for developers) as a JSON object matching the
schema shown by the EXAMPLE below. Output ONLY the JSON object, no prose.

Hard requirements:
- CEFR level ${brief.level}. Keep vocabulary and structures at or below this level (short sentences,
  ~5-8 words on average). The episode's grammar focus is ${JSON.stringify(brief.grammarName)}.
- Characters stay consistent with the story bible (names, roles, quirks). Warm, light humour.
- vocab.words: 10-12 items, each {word, ru, ipa, example, exampleRu}; single words preferred (they
  feed a crossword). ru = Russian translation, ipa = IPA in slashes.
- grammar: {title:{en,ru}, ref:${JSON.stringify(brief.grammarRef)}, rule:{en,ru},
  patterns:[{label:{en,ru}, formula, examples:[{en,ru}], ref}], pitfalls:[{en,ru}]}.
- reading.blocks: exactly 3 short blocks telling the story, each {en, ru}. Put "image":"b1" on the
  first block and "image":"b3" on the third (illustrations are added later).
- reading.glossary: 3-5 helper words {word, ru, ipa}.
- listening.dialogue: 5 SHORT lines (3-6 words each), each ["en","ru"] — used for dictation.
- listening.exercises: exactly 1 "choice" exercise about a detail of the dialogue.
- practice.exercises: 8-10 exercises mixing types: gap-fill, choice, spot-error, order-words, match,
  translate (direction "ru-en"). Every exercise id starts with "${brief.id}.ex.". choice/spot-error
  need correctIndex; gap-fill/translate need answers[]; order-words need tokens[]+correctOrder[];
  match needs pairs[{left,right}]. Add commonErrors[] to translate items where useful.
- tags on exercises come from the project registry (e.g. "${(brief.tags || []).join('", "')}",
  "writing.translation", "listening.detail", "vocab.food"). Do NOT invent tags.
- Every RU field must be present and correct. Do NOT include audio, level, or media paths.

STORY BIBLE (for character/tone consistency):
${bible}

EXAMPLE (a complete, valid episode spec — match this structure exactly):
${example}
`;

const userMsg = `Write episode "${brief.episode}" for unit ${brief.unitId} at level ${brief.level}.
Grammar focus: ${JSON.stringify(brief.grammarName)}.
Characters: ${(brief.characters || []).join(', ')}.
Plot: ${brief.scenario}

Return the JSON spec. Use these exact meta fields at the top:
"id": ${JSON.stringify(brief.id)}, "unitId": ${JSON.stringify(brief.unitId)}, "insertAt": ${brief.insertAt ?? 2}, "tags": ${JSON.stringify(brief.tags)}.`;

const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${envKey('DEEPSEEK_API_KEY')}` },
  body: JSON.stringify({
    model,
    messages: [
      { role: 'system', content: RULES },
      { role: 'user', content: userMsg },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.8,
  }),
});
if (!res.ok) {
  console.error('DeepSeek error', res.status, await res.text());
  process.exit(1);
}
const data = await res.json();
const content = data.choices?.[0]?.message?.content;
let spec;
try {
  spec = JSON.parse(content);
} catch {
  console.error('Model did not return valid JSON:\n', content?.slice(0, 500));
  process.exit(1);
}
// Enforce authored meta regardless of what the model echoed.
spec.id = brief.id;
spec.unitId = brief.unitId;
spec.insertAt = brief.insertAt ?? 2;
spec.tags = brief.tags;

const out = join(HERE, 'specs', `${brief.id}.json`);
writeFileSync(out, JSON.stringify(spec, null, 2) + '\n');
console.log('Wrote', out);
console.log('Review it, run level_check on the reading, then: node tools/content-forge/story/build-episode.mjs', out);
console.log('Usage:', JSON.stringify({ prompt: data.usage?.prompt_tokens, completion: data.usage?.completion_tokens }));
