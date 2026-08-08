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
  ctx: { prompt: string; userAnswer: string; correct: string; topic: string }
): Promise<string> {
  const user =
    `Задание: "${ctx.prompt}"\n` +
    `Ответ ученика: "${ctx.userAnswer}"\n` +
    `Правильный ответ: "${ctx.correct}"\n` +
    `Тема: ${ctx.topic}\n` +
    'Объясни в 1–2 предложениях, почему ответ ученика неверный, и какое правило работает. Не морализируй.';
  return ask(config, RU_TUTOR, user, `explain|${ctx.prompt}|${ctx.userAnswer}`);
}

export function hint(
  config: AiConfig,
  ctx: { prompt: string; topic: string }
): Promise<string> {
  const system = `${RU_TUTOR} Дай наводящую подсказку, но НИКОГДА не давай готовый ответ.`;
  const user = `Задание: "${ctx.prompt}"\nТема: ${ctx.topic}\nОдна короткая подсказка, которая направляет, но не раскрывает ответ.`;
  return ask(config, system, user, `hint|${ctx.prompt}`);
}

export function wordInContext(
  config: AiConfig,
  word: string,
  sentence: string
): Promise<string> {
  const user =
    `Слово: "${word}"\nПредложение: "${sentence}"\n` +
    'Объясни значение слова именно в этом предложении (не словарную статью) в одном предложении.';
  return ask(config, RU_TUTOR, user, `wic|${word}|${sentence}`);
}
