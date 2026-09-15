import { complete, type AiConfig } from './provider';
import { runTask, aiPathLabel } from './route';
import type { AiTaskRequest } from '@/features/account/contract';
import { clampBand, simplifySystem, simplifyShot, SIMPLIFY_PROMPT_VERSION, type Band } from './simplify-prompts';
import { db } from '@/db/db';
import type { Exercise, Level } from '@/content/schema';

const RU_TRANSLATOR =
  'Ты — переводчик с английского на русский. Переведи текст точно и естественно. Верни ТОЛЬКО перевод, без пояснений и без кавычек.';

const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

/**
 * Translate a reader sentence or phrase EN→RU with the BYOK model. When `sentence` context is given and
 * differs from the text, the model translates the FRAGMENT as it means IN that sentence (so "fowling
 * pieces" becomes "охотничьи ружья", not a literal "кусочки") and returns only the fragment's
 * translation. Cached in IndexedDB under an `ai:`-namespaced key (context included in the key) so it
 * never collides with (or evicts, via localStorage quota) the free path or other AI features. Only a
 * real Russian result is cached — a model that echoes English or refuses is NOT persisted; it throws so
 * the caller can fall back to the free translator.
 */
export async function aiTranslate(
  config: AiConfig | null,
  text: string,
  opts: { sentence?: string; signal?: AbortSignal } = {}
): Promise<string> {
  const q = text.trim();
  if (!q) return '';
  const ctx = opts.sentence?.trim();
  const inContext = ctx && ctx !== q ? ctx : undefined;
  const path = aiPathLabel(config);
  const cacheKey = inContext ? `ai:${path}:${q}|@|${inContext}` : `ai:${path}:${q}`;
  try {
    const cached = await db.translations.get(cacheKey);
    if (cached && hasCyrillic(cached.ru)) return cached.ru;
  } catch {
    // ignore cache miss
  }
  const user = inContext
    ? `Фрагмент: "${q}"\nПредложение: "${inContext}"\nПереведи ТОЛЬКО фрагмент так, как он значит в этом предложении. Верни только перевод фрагмента.`
    : q;
  const raw = await runTask({ task: 'translate', text: q, sentence: inContext }, config, (c) =>
    complete(
      c,
      [
        { role: 'system', content: RU_TRANSLATOR },
        { role: 'user', content: user },
      ],
      { temperature: 0.2, maxTokens: 300, noReasoning: true, signal: opts.signal }
    )
  );
  const ru = raw.trim().replace(/^["'«»“”]+|["'«»“”]+$/g, '').trim();
  if (!hasCyrillic(ru)) throw new Error('ai translation is not Russian');
  try {
    await db.translations.put({ word: cacheKey, ru, source: 'ai' });
  } catch {
    // best-effort cache
  }
  return ru;
}

/** Strip the model's wrapping noise so a lead-in ("Here is the simpler version: …"), code fence,
 *  markdown bold, list bullet, or surrounding quotes doesn't render as the rewrite. */
function cleanRewrite(raw: string): string {
  const noFence = raw.trim().replace(/^```[a-z]*\n?|\n?```$/gi, '').trim();
  // Drop a leading meta lead-in that ends in a colon ("Here is the simpler version:", "Simplified:").
  const noLead = noFence.replace(/^[^:\n]{0,60}\b(here|simpl\w*|version|rewrite|sure|okay)\b[^:\n]{0,60}:\s*/i, '');
  return noLead
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^["'«»“”\s]+|["'«»“”\s]+$/g, '')
    .trim();
}

const countCyrillic = (s: string): number => (s.match(/[а-яё]/gi) ?? []).length;
const countLatin = (s: string): number => (s.match(/[a-z]/gi) ?? []).length;

/**
 * Reader "Simplify" lens: rewrite ONE English sentence in simpler English at the learner's CEFR band
 * (from placement; `stepDown` walks the band ladder toward A1 for the "even simpler" action). Mirrors
 * `aiTranslate` — same `complete()` + temp 0.2, cached in `db.translations` under a `lens:simplify:`
 * key (English in `en`, so `hasCyrillic`-gated translate consumers ignore it). Output is validated
 * (de-noised, non-empty, predominantly English) before caching; garbage throws so the caller can offer
 * the RU fallback. An echo (result ≈ input) is returned as-is — the caller decides how to render it.
 */
export async function aiSimplify(
  config: AiConfig | null,
  sentence: string,
  opts: { level?: Level | null; stepDown?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const q = sentence.trim();
  if (!q) return '';
  const band = clampBand(opts.level, opts.stepDown);
  const cacheKey = `lens:simplify:${SIMPLIFY_PROMPT_VERSION}:${band}:${aiPathLabel(config)}:${q}`;
  try {
    const cached = await db.translations.get(cacheKey);
    if (cached?.en) return cached.en;
  } catch {
    // ignore cache miss
  }
  const shot = simplifyShot(band);
  const raw = await runTask(
    { task: 'simplify', sentence: q, level: opts.level ?? undefined, stepDown: opts.stepDown },
    config,
    (c) =>
      complete(
        c,
        [
          { role: 'system', content: simplifySystem(band) },
          { role: 'user', content: shot.src },
          { role: 'assistant', content: shot.out },
          { role: 'user', content: q },
        ],
        // `noReasoning` disables/minimizes chain-of-thought (deepseek off entirely; groq gpt-oss only down
        // to 'low' — it can't turn off). The cap must therefore leave room for any residual reasoning PLUS
        // the answer, or `content` comes back empty; 512 covers groq's low-effort reasoning and is a
        // harmless ceiling for deepseek (which stops naturally at ~50). Kills the 48k runaway either way.
        { temperature: 0.2, maxTokens: 512, noReasoning: true, signal: opts.signal }
      )
  );
  const out = cleanRewrite(raw);
  // Reject empty, runaway, or a straight RU translation (model ignored "English only").
  if (!out || out.length > Math.max(140, q.length * 5) || countCyrillic(out) > countLatin(out)) {
    throw new Error('ai simplification unavailable');
  }
  try {
    await db.translations.put({ word: cacheKey, ru: '', en: out, source: 'lens-simplify' });
  } catch {
    // best-effort cache
  }
  return out;
}

// Bumped with the prompt: this key does NOT hash the prompt (unlike the server's), so without a bump
// every sentence a user has already looked at keeps serving the old, short-form answer forever.
const GRAMMAR_VERSION = 'v2';
/**
 * Two shots, not one. The short example alone taught the model to answer in that shape regardless of
 * the input, which is why a 60-word period came back explained as if it were a simple sentence: a
 * completed example outweighs a system rule. The second shot demonstrates the skeleton-then-detail
 * form the rules ask for on a multi-clause sentence.
 *
 * MUST stay byte-identical with the copy in server/src/aiPrompts.ts — the managed and BYOK paths have
 * to give the same answer. `grammar-prompt-parity.test.ts` guards it.
 */
const GRAMMAR_SHOTS = [
  {
    src: 'By the time we arrived, the film had already started.',
    out: 'Главное здесь — «had started» (Past Perfect): фильм начался РАНЬШЕ, чем мы пришли. Так показывают, что одно прошлое действие произошло до другого.',
  },
  {
    src: 'The letter, which had been lying on the hall table since Tuesday, was still unopened when she finally came home, although everyone had told her it was urgent.',
    out: 'Скелет: «the letter was unopened» — всё остальное уточнения: «which had been lying…» (какое письмо), «when she came home» (когда), «although…» (вопреки чему). Труднее всего «had been lying»: письмо пролежало там какое-то время ДО того момента, о котором речь.',
  },
];
function grammarSystem(band: Band): string {
  return [
    `Ты объясняешь грамматику английского предложения русскоговорящему ученику уровня CEFR ${band}.`,
    'Правила:',
    '1. Если в предложении одна грамматическая основа — разбери ОДНУ самую важную/трудную для этого уровня конструкцию.',
    '2. Если основ несколько — сначала ОДНОЙ фразой назови скелет (что здесь главное и что к чему цепляется), и только потом разбери самую трудную часть. Не пересказывай всё подряд.',
    '3. Уложись примерно в 70 слов. Не читай лекцию и не приводи посторонних примеров.',
    '4. Термин называй только если без него никак (лучше «действие, которое ещё длится», чем «Present Continuous»).',
    '5. Опирайся именно на это предложение. Верни ТОЛЬКО объяснение — без вступлений, кавычек и markdown.',
  ].join('\n');
}

/**
 * Reader "Grammar" lens: explain (in Russian) the ONE most salient/level-relevant grammar structure of a
 * sentence — Noticing / consciousness-raising, not a textbook dump. Mirrors `aiSimplify`; the length
 * discipline comes from the prompt + few-shot, not a tight cap. Cached in `db.translations` under a
 * `lens:grammar:` key in the `ru` field (namespaced — never read by the translate path). Rejects a
 * non-Russian answer so the caller can fall back.
 */
export async function aiGrammar(
  config: AiConfig | null,
  sentence: string,
  opts: { level?: Level | null; signal?: AbortSignal } = {}
): Promise<string> {
  const q = sentence.trim();
  if (!q) return '';
  const band = clampBand(opts.level, 0);
  const cacheKey = `lens:grammar:${GRAMMAR_VERSION}:${band}:${aiPathLabel(config)}:${q}`;
  try {
    const cached = await db.translations.get(cacheKey);
    if (cached?.ru) return cached.ru;
  } catch {
    // ignore cache miss
  }
  const raw = await runTask({ task: 'grammar', sentence: q, level: opts.level ?? undefined }, config, (c) =>
    complete(
      c,
      [
        { role: 'system', content: grammarSystem(band) },
        ...GRAMMAR_SHOTS.flatMap((s) => [
          { role: 'user' as const, content: s.src },
          { role: 'assistant' as const, content: s.out },
        ]),
        { role: 'user', content: q },
      ],
      // 700, not 512: the answer target went from ~40 to ~70 words, and on groq's gpt-oss reasoning
      // cannot be turned off and eats the same budget — the old cap left no headroom on that path.
      { temperature: 0.3, maxTokens: 700, noReasoning: true, signal: opts.signal }
    )
  );
  const out = cleanRewrite(raw);
  if (!out || !hasCyrillic(out)) throw new Error('ai grammar unavailable'); // empty or answered in English
  try {
    await db.translations.put({ word: cacheKey, ru: out, source: 'lens-grammar' });
  } catch {
    // best-effort cache
  }
  return out;
}

function cacheGet(key: string): string | undefined {
  try {
    return localStorage.getItem(`ai:${key}`) ?? undefined;
  } catch {
    return undefined;
  }
}
function cacheSet(key: string, value: string): void {
  try {
    localStorage.setItem(`ai:${key}`, value);
  } catch {
    // ignore
  }
}

async function ask(
  config: AiConfig | null,
  req: AiTaskRequest,
  system: string,
  user: string,
  cacheKey: string
): Promise<string> {
  const key = `${aiPathLabel(config)}|${cacheKey}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const out = await runTask(req, config, (c) =>
    complete(
      c,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { noReasoning: true, maxTokens: 220 }
    )
  );
  cacheSet(key, out);
  return out;
}

const RU_TUTOR =
  'Ты — преподаватель английского для русскоговорящего ученика уровня A2–B1. Отвечай кратко и по-русски.';

export function explainError(
  config: AiConfig | null,
  ctx: {
    prompt: string;
    userAnswer: string;
    correct: string;
    topic: string;
    attempts?: string[];
  }
): Promise<string> {
  const history =
    ctx.attempts && ctx.attempts.length > 1
      ? `Все попытки ученика по порядку: ${ctx.attempts
          .map((a, i) => `${i + 1}) "${a}"`)
          .join('; ')}\n`
      : `Ответ ученика: "${ctx.userAnswer}"\n`;
  const user =
    `Задание: "${ctx.prompt}"\n` +
    history +
    `Правильный ответ: "${ctx.correct}"\n` +
    `Тема: ${ctx.topic}\n` +
    'Объясни в 1–2 предложениях, в чём именно ошибка (укажи на неё конкретно, например порядок слов или форму), какое правило работает. Если попыток несколько — отметь, какая была ближе. ' +
    'Опирайся ТОЛЬКО на текст задания и данные ответы: не выдумывай содержание аудио или текста, которых тебе не показали. Если суть ошибки зависит от непоказанного материала (например, это восприятие на слух), объясни разницу между вариантами ответа и что стоит переслушать/перечитать. Не морализируй.';
  return ask(
    config,
    {
      task: 'explain',
      prompt: ctx.prompt,
      userAnswer: ctx.userAnswer,
      correct: ctx.correct,
      topic: ctx.topic,
      attempts: ctx.attempts,
    },
    RU_TUTOR,
    user,
    `explain|${ctx.prompt}|${ctx.attempts?.join('|') ?? ctx.userAnswer}`
  );
}

export function hint(
  config: AiConfig | null,
  ctx: { prompt: string; topic: string; userAnswer?: string; attempt?: number }
): Promise<string> {
  const system = `${RU_TUTOR} Дай наводящую подсказку, но НИКОГДА не давай готовый ответ.`;
  const answerLine = ctx.userAnswer?.trim()
    ? `Текущий (неверный) ответ ученика: "${ctx.userAnswer}" — направь именно к его ошибке.\n`
    : '';
  const user =
    `Задание: "${ctx.prompt}"\n` +
    answerLine +
    `Тема: ${ctx.topic}\n` +
    'Одна короткая подсказка, которая направляет к исправлению, но НЕ раскрывает готовый ответ.';
  // No cache: a hint must react to the current answer, and re-requesting after a
  // change must return a fresh hint, not a stale cached one.
  return runTask({ task: 'hint', prompt: ctx.prompt, topic: ctx.topic, userAnswer: ctx.userAnswer }, config, (c) =>
    complete(
      c,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { noReasoning: true, maxTokens: 160 }
    )
  );
}

type AiItem = { q?: unknown; options?: unknown; answer?: unknown };

/** Coerce the model's loose JSON into valid choice exercises, dropping anything malformed. */
export function coerceExercises(raw: string, idPrefix: string): Exercise[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let items: AiItem[];
  try {
    items = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const out: Exercise[] = [];
  items.forEach((it, i) => {
    const q = typeof it?.q === 'string' ? it.q : '';
    const answer = typeof it?.answer === 'string' ? it.answer.trim() : '';
    const options = Array.isArray(it?.options)
      ? [...new Set(it.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim()))]
      : [];
    if (!q.includes('___') || answer === '' || options.length < 2 || !options.includes(answer)) return;
    out.push({
      type: 'choice',
      id: `${idPrefix}.ai.${i}`,
      instruction: {
        en: 'Choose the missing word from the text.',
        ru: 'Выбери пропущенное слово из текста.',
      },
      tags: ['reader.vocab'],
      prompt: q,
      options,
      correctIndex: options.indexOf(answer),
    });
  });
  return out;
}

/** Generate vocabulary exercises from a chapter with the AI (the "both" option alongside deterministic). */
export async function generateReaderExercises(
  config: AiConfig | null,
  ctx: { text: string; targets: string[]; idPrefix: string; count?: number }
): Promise<Exercise[]> {
  const n = ctx.count ?? 6;
  const targetLine = ctx.targets.length
    ? `По возможности проверяй эти слова: ${ctx.targets.slice(0, 12).join(', ')}.\n`
    : '';
  const system =
    'Ты — преподаватель английского. Составляешь задания на понимание слов по тексту. ' +
    'Отвечай СТРОГО одним JSON-массивом, без пояснений и markdown.';
  const user =
    `Фрагмент главы:\n"""${ctx.text.slice(0, 1500)}"""\n` +
    targetLine +
    `Составь ${n} заданий «выбери пропущенное слово». Для каждого возьми предложение ИЗ текста, ` +
    'замени одно содержательное слово на ___ и дай 4 варианта: один верный (исходное слово) и три ' +
    'правдоподобных неверных той же части речи. Формат каждого элемента: ' +
    '{"q":"предложение с ___","options":["w1","w2","w3","w4"],"answer":"верное"}. Только JSON-массив.';
  const raw = await runTask({ task: 'exercises', text: ctx.text, targets: ctx.targets, count: n }, config, (c) =>
    complete(
      c,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { noReasoning: true, maxTokens: 700 }
    )
  );
  return coerceExercises(raw, ctx.idPrefix);
}

export function wordInContext(
  config: AiConfig | null,
  word: string,
  sentence: string
): Promise<string> {
  const user =
    `Слово: "${word}"\nПредложение: "${sentence}"\n` +
    'Дай перевод слова ИМЕННО в этом предложении (одно-два слова). ' +
    'Затем, если у слова есть другие частые значения, добавь строкой "Ещё: …" с 1–2 из них. Кратко.';
  return ask(config, { task: 'wordInContext', word, sentence }, RU_TUTOR, user, `wic|${word}|${sentence}`);
}
