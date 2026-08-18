import { complete, type AiConfig } from './provider';

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
