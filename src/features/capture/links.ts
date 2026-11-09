export type CapturePayload = {
  term: string;
  translation: string;
  context: string;
  source: 'vk' | 'telegram' | null;
};
export type CaptureLink =
  | { ok: true; value: CapturePayload }
  | { ok: false; error: 'invalid' | 'version' | 'missing' };
export const CAPTURE_LIMITS = { term: 240, translation: 500, context: 1000 };
const hasControls = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code < 9 || (code > 10 && code < 32) || code === 127 || code === 65533
    );
  });
export const captureKey = (term: string) =>
  term.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").toLowerCase();
export const isCapturePath = (path: string) =>
  /^\/capture(?:-web)?\/?$/.test(path);

export function parseCaptureLink(raw: string): CaptureLink {
  if (raw.length > 8000 || /%(?![\da-f]{2})/i.test(raw))
    return { ok: false, error: 'invalid' };
  try {
    const url = new URL(raw);
    const web =
      url.protocol === 'https:' &&
      url.hostname === 'dayenglish.ru' &&
      isCapturePath(url.pathname);
    const native =
      url.protocol === 'dayenglish:' &&
      url.hostname === 'capture' &&
      (url.pathname === '' || url.pathname === '/');
    if (
      (!web && !native) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return { ok: false, error: 'invalid' };
    for (const name of ['v', 'en', 'ru', 'ctx', 'src'])
      if (url.searchParams.getAll(name).length > 1)
        return { ok: false, error: 'invalid' };
    if (url.searchParams.get('v') !== '1')
      return { ok: false, error: 'version' };
    const term = url.searchParams.get('en') ?? '',
      translation = url.searchParams.get('ru') ?? '',
      context = url.searchParams.get('ctx') ?? '';
    if ([term, translation, context].some(hasControls))
      return { ok: false, error: 'invalid' };
    if (!term.trim()) return { ok: false, error: 'missing' };
    const source = url.searchParams.get('src');
    return {
      ok: true,
      value: {
        term,
        translation,
        context,
        source:
          source === 'vk'
            ? 'vk'
            : source === 'tg' || source === 'telegram'
              ? 'telegram'
              : null,
      },
    };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

export function captureLink(
  payload: CapturePayload,
  browserOnly = false
): string {
  const url = new URL(
    browserOnly
      ? 'https://dayenglish.ru/capture-web'
      : 'https://dayenglish.ru/capture'
  );
  url.search = new URLSearchParams({
    v: '1',
    en: payload.term,
    ru: payload.translation,
    ...(payload.context ? { ctx: payload.context } : {}),
    ...(payload.source ? { src: payload.source === 'vk' ? 'vk' : 'tg' } : {}),
  }).toString();
  return url.href;
}

export function androidCaptureIntent(payload: CapturePayload): string {
  const query = new URL(captureLink(payload)).search;
  return (
    'intent://capture' +
    query +
    '#Intent;scheme=dayenglish;package=ru.dayenglish.app;S.browser_fallback_url=' +
    encodeURIComponent(captureLink(payload, true)) +
    ';end'
  );
}

export function captureDraftError(
  payload: CapturePayload
): 'term' | 'translation' | 'context' | null {
  if (
    !payload.term.trim() ||
    payload.term.length > CAPTURE_LIMITS.term ||
    hasControls(payload.term) ||
    !/[a-z]/i.test(payload.term)
  )
    return 'term';
  if (
    !payload.translation.trim() ||
    payload.translation.length > CAPTURE_LIMITS.translation ||
    hasControls(payload.translation)
  )
    return 'translation';
  if (
    payload.context.length > CAPTURE_LIMITS.context ||
    hasControls(payload.context)
  )
    return 'context';
  return null;
}
