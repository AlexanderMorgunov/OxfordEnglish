import { complete, type AiConfig } from './provider';
import { db } from '@/db/db';
import type { Exercise } from '@/content/schema';

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
  config: AiConfig,
  text: string,
  opts: { sentence?: string; signal?: AbortSignal } = {}
): Promise<string> {
  const q = text.trim();
  if (!q) return '';
  const ctx = opts.sentence?.trim();
  const inContext = ctx && ctx !== q ? ctx : undefined;
  const cacheKey = inContext ? `ai:${config.model}:${q}|@|${inContext}` : `ai:${config.model}:${q}`;
  try {
    const cached = await db.translations.get(cacheKey);
    if (cached && hasCyrillic(cached.ru)) return cached.ru;
  } catch {
    // ignore cache miss
  }
  const user = inContext
    ? `Фрагмент: "${q}"\nПредложение: "${inContext}"\nПереведи ТОЛЬКО фрагмент так, как он значит в этом предложении. Верни только перевод фрагмента.`
    : q;
  const raw = await complete(
    config,
    [
      { role: 'system', content: RU_TRANSLATOR },
      { role: 'user', content: user },
    ],
    { temperature: 0.2, signal: opts.signal }
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
  config: AiConfig,
  system: string,
  user: string,
  cacheKey: string
): Promise<string> {
  const key = `${config.model}|${cacheKey}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const out = await complete(config, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  cacheSet(key, out);
  return out;
}

const RU_TUTOR =
  'Ты — преподаватель английского для русскоговорящего ученика уровня A2–B1. Отвечай кратко и по-русски.';

export function explainError(
  config: AiConfig,
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
    'Объясни в 1–2 предложениях, в чём именно ошибка (укажи на неё конкретно, например порядок слов или форму), какое правило работает. Если попыток несколько — отметь, какая была ближе. Не морализируй.';
  return ask(config, RU_TUTOR, user, `explain|${ctx.prompt}|${ctx.attempts?.join('|') ?? ctx.userAnswer}`);
}

export function hint(
  config: AiConfig,
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
  return complete(config, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
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
  config: AiConfig,
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
  const raw = await complete(config, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  return coerceExercises(raw, ctx.idPrefix);
}

export function wordInContext(
  config: AiConfig,
  word: string,
  sentence: string
): Promise<string> {
  const user =
    `Слово: "${word}"\nПредложение: "${sentence}"\n` +
    'Дай перевод слова ИМЕННО в этом предложении (одно-два слова). ' +
    'Затем, если у слова есть другие частые значения, добавь строкой "Ещё: …" с 1–2 из них. Кратко.';
  return ask(config, RU_TUTOR, user, `wic|${word}|${sentence}`);
}
