/**
 * Prompt construction for the managed (server-key) AI path — a DELIBERATE MIRROR of the client's
 * `src/features/ai/{functions,simplify-prompts}.ts`, the same arrangement `contract.ts` has with the
 * client contract and the sync resolvers have with `resolve.ts`.
 *
 * Why mirrored rather than shared: BYOK users call the provider straight from the browser with their own
 * key, so the client must keep its copy; the managed path must build prompts HERE, because a proxy that
 * accepts client-supplied messages is a general-purpose LLM gateway billed to us.
 *
 * Keep the two in sync on any change, and bump the task's version in ai.ts when a prompt changes —
 * the cache key carries it, so a stale rewrite is never served after an edit.
 */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export const BANDS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Band = (typeof BANDS)[number];

/** Learner level → target band, then step down toward A1. C1/C2 clamp to B2 (simplifying "to C1" is
 *  meaningless); an unknown level (placement not done) defaults to B1. */
export function clampBand(level: string | null | undefined, stepDown = 0): Band {
  const base: Band =
    level === 'A1' ? 'A1' : level === 'A2' ? 'A2' : level === 'B2' || level === 'C1' || level === 'C2' ? 'B2' : 'B1';
  return BANDS[Math.max(0, BANDS.indexOf(base) - Math.max(0, stepDown))] ?? 'A1';
}

type BandRule = { maxSentences: number; words: number; vocab: string; grammar: string; exIn: string; exOut: string };

const RULES: Record<Band, BandRule> = {
  A1: {
    maxSentences: 3,
    words: 8,
    vocab: 'Use only very common words — the Oxford 3000 A1 band (about the 900 most basic English words).',
    grammar:
      'Use only present simple, present continuous, and "going to" future. No passive voice, no relative clauses, no perfect tenses. One clause per sentence.',
    exIn: 'Having finished his supper, the old fisherman trudged wearily home.',
    exOut: 'The old fisherman finished his dinner. Then he walked home. He was very tired.',
  },
  A2: {
    maxSentences: 3,
    words: 12,
    vocab: 'Use common words from the Oxford 3000 A1–A2 bands (about the 2000 most common English words).',
    grammar:
      'Allowed: past simple, present perfect, comparatives, and "because / but / when" clauses. Avoid passive voice, reported speech, and participle clauses.',
    exIn: 'Scarcely had the vessel departed when the tempest descended upon the harbour.',
    exOut: 'The ship left. Then a big storm came to the harbour.',
  },
  B1: {
    maxSentences: 3,
    words: 16,
    vocab: 'Use words from the Oxford 3000 (A1–B1 bands). Replace literary, archaic, or low-frequency words with everyday equivalents.',
    grammar: 'Most structures are fine, but avoid inversion, participle clauses, and nested relative clauses. Prefer active voice.',
    exIn: 'Not until the letter arrived did she comprehend the magnitude of her error.',
    exOut: 'She understood how serious her mistake was only when the letter arrived.',
  },
  B2: {
    maxSentences: 3,
    words: 20,
    vocab: 'Use words from the Oxford 3000/5000 up to B2. Replace archaic, dialectal, and very literary vocabulary; keep neutral-formal vocabulary as is.',
    grammar: 'Keep natural complex grammar; only unwind heavily literary syntax (inversion, long periodic sentences, chains of subordinate clauses).',
    exIn: 'The old mariner, his visage weathered, did resolve to quit the sea forthwith.',
    exOut: 'The old sailor, with his weathered face, decided to leave the sea at once.',
  },
};

/** Constant system prompt per band (byte-identical → the provider's own prefix cache can hit). The worked
 *  example goes in a separate user/assistant turn, never inlined — an inline "A -> B" invites the model to
 *  continue the pattern and run away. */
export function simplifySystem(band: Band): string {
  const r = RULES[band];
  return [
    `You rewrite ONE English sentence for an English learner at CEFR level ${band}.`,
    'Rules:',
    '1. Keep the meaning EXACTLY. Never add facts, opinions, or new information. Keep all names, numbers, dates, and negations unchanged.',
    '2. Reply with ONLY the rewritten sentence(s) in English — no quotes, no markdown, no explanation, no preamble, no notes. Then stop.',
    `3. You may split one long sentence into up to ${r.maxSentences} short sentences of about ${r.words} words each.`,
    `4. ${r.vocab}`,
    `5. ${r.grammar}`,
    '6. If a rare word is essential (a technical term, a key object), keep it and add a short gloss in dashes: "the harpoon — a spear for hunting whales".',
    `7. If the sentence is already simple enough for ${band}, return it unchanged.`,
  ].join('\n');
}

export function simplifyShot(band: Band): { src: string; out: string } {
  return { src: RULES[band].exIn, out: RULES[band].exOut };
}

export const RU_TRANSLATOR =
  'Ты — переводчик с английского на русский. Переведи текст точно и естественно. Верни ТОЛЬКО перевод, без пояснений и без кавычек.';

export const RU_TUTOR =
  'Ты — преподаватель английского для русскоговорящего ученика уровня A2–B1. Отвечай кратко и по-русски.';

const GRAMMAR_SHOT = {
  src: 'By the time we arrived, the film had already started.',
  out: 'Главное здесь — «had started» (Past Perfect): фильм начался РАНЬШЕ, чем мы пришли. Так показывают, что одно прошлое действие произошло до другого.',
};

export function grammarSystem(band: Band): string {
  return [
    `Ты объясняешь грамматику английского предложения русскоговорящему ученику уровня CEFR ${band}.`,
    'Правила:',
    '1. Найди ОДНУ самую важную/трудную для этого уровня конструкцию в предложении — не разбирай всё подряд.',
    '2. Объясни её просто, по-русски, в 2–3 коротких предложениях (не длиннее ~40 слов). Не читай лекцию и не приводи посторонних примеров.',
    '3. Термин называй только если без него никак (лучше «действие, которое ещё длится», чем «Present Continuous»).',
    '4. Опирайся именно на это предложение. Верни ТОЛЬКО объяснение — без вступлений, кавычек и markdown.',
  ].join('\n');
}

export const translateMessages = (text: string, sentence?: string): ChatMessage[] => {
  const inContext = sentence && sentence !== text ? sentence : undefined;
  const user = inContext
    ? `Фрагмент: "${text}"\nПредложение: "${inContext}"\nПереведи ТОЛЬКО фрагмент так, как он значит в этом предложении. Верни только перевод фрагмента.`
    : text;
  return [
    { role: 'system', content: RU_TRANSLATOR },
    { role: 'user', content: user },
  ];
};

export const simplifyMessages = (sentence: string, band: Band): ChatMessage[] => {
  const shot = simplifyShot(band);
  return [
    { role: 'system', content: simplifySystem(band) },
    { role: 'user', content: shot.src },
    { role: 'assistant', content: shot.out },
    { role: 'user', content: sentence },
  ];
};

export const grammarMessages = (sentence: string, band: Band): ChatMessage[] => [
  { role: 'system', content: grammarSystem(band) },
  { role: 'user', content: GRAMMAR_SHOT.src },
  { role: 'assistant', content: GRAMMAR_SHOT.out },
  { role: 'user', content: sentence },
];

/** Page text is the CONSTANT system prefix so the provider's prefix cache hits across questions on the
 *  same page; the varying question goes last. */
export const bookQaMessages = (pageText: string, question: string): ChatMessage[] => [
  {
    role: 'system',
    content:
      'Ты отвечаешь на вопрос ученика по фрагменту книги, который он сейчас читает. Отвечай КРАТКО и по-русски, ' +
      'ТОЛЬКО на основе приведённого ниже текста — не додумывай и не используй знания извне. Если ответа в тексте ' +
      'нет, честно скажи: «В этом фрагменте об этом не сказано.» Если в тексте есть предложение, прямо подтверждающее ' +
      'ответ, добавь его ПОСЛЕДНЕЙ строкой в формате: ЦИТАТА: <точное предложение из текста>.\n\nТекст:\n"""\n' +
      pageText +
      '\n"""',
  },
  { role: 'user', content: question },
];

export const wordInContextMessages = (word: string, sentence: string): ChatMessage[] => [
  { role: 'system', content: RU_TUTOR },
  {
    role: 'user',
    content:
      `Слово: "${word}"\nПредложение: "${sentence}"\n` +
      'Дай перевод слова ИМЕННО в этом предложении (одно-два слова). ' +
      'Затем, если у слова есть другие частые значения, добавь строкой "Ещё: …" с 1–2 из них. Кратко.',
  },
];

export const explainMessages = (ctx: {
  prompt: string;
  userAnswer: string;
  correct: string;
  topic: string;
  attempts?: string[];
}): ChatMessage[] => {
  const history =
    ctx.attempts && ctx.attempts.length > 1
      ? `Все попытки ученика по порядку: ${ctx.attempts.map((a, i) => `${i + 1}) "${a}"`).join('; ')}\n`
      : `Ответ ученика: "${ctx.userAnswer}"\n`;
  return [
    { role: 'system', content: RU_TUTOR },
    {
      role: 'user',
      content:
        `Задание: "${ctx.prompt}"\n` +
        history +
        `Правильный ответ: "${ctx.correct}"\n` +
        `Тема: ${ctx.topic}\n` +
        'Объясни в 1–2 предложениях, в чём именно ошибка (укажи на неё конкретно, например порядок слов или форму), какое правило работает. Если попыток несколько — отметь, какая была ближе. ' +
        'Опирайся ТОЛЬКО на текст задания и данные ответы: не выдумывай содержание аудио или текста, которых тебе не показали. Если суть ошибки зависит от непоказанного материала (например, это восприятие на слух), объясни разницу между вариантами ответа и что стоит переслушать/перечитать. Не морализируй.',
    },
  ];
};

export const hintMessages = (ctx: { prompt: string; topic: string; userAnswer?: string }): ChatMessage[] => {
  const answerLine = ctx.userAnswer?.trim()
    ? `Текущий (неверный) ответ ученика: "${ctx.userAnswer}" — направь именно к его ошибке.\n`
    : '';
  return [
    { role: 'system', content: `${RU_TUTOR} Дай наводящую подсказку, но НИКОГДА не давай готовый ответ.` },
    {
      role: 'user',
      content:
        `Задание: "${ctx.prompt}"\n` +
        answerLine +
        `Тема: ${ctx.topic}\n` +
        'Одна короткая подсказка, которая направляет к исправлению, но НЕ раскрывает готовый ответ.',
    },
  ];
};

export const exercisesMessages = (ctx: { text: string; targets: string[]; count: number }): ChatMessage[] => {
  const targetLine = ctx.targets.length
    ? `По возможности проверяй эти слова: ${ctx.targets.slice(0, 12).join(', ')}.\n`
    : '';
  return [
    {
      role: 'system',
      content:
        'Ты — преподаватель английского. Составляешь задания на понимание слов по тексту. ' +
        'Отвечай СТРОГО одним JSON-массивом, без пояснений и markdown.',
    },
    {
      role: 'user',
      content:
        `Фрагмент главы:\n"""${ctx.text.slice(0, 1500)}"""\n` +
        targetLine +
        `Составь ${ctx.count} заданий «выбери пропущенное слово». Для каждого возьми предложение ИЗ текста, ` +
        'замени одно содержательное слово на ___ и дай 4 варианта: один верный (исходное слово) и три ' +
        'правдоподобных неверных той же части речи. Формат каждого элемента: ' +
        '{"q":"предложение с ___","options":["w1","w2","w3","w4"],"answer":"верное"}. Только JSON-массив.',
    },
  ];
};
