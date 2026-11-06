import { describe, expect, test } from 'vitest';
import {
  androidCaptureIntent,
  captureDraftError,
  captureKey,
  captureLink,
  isCapturePath,
  parseCaptureLink,
} from './links';
import { nativeCapturePath } from './native';

const phrase = {
  term: 'It depends',
  translation: 'Зависит от ситуации',
  context: 'A & B? <example>',
  source: 'telegram' as const,
};
test('round trip is plain text with a version and no implicit source attribution', () => {
  expect(parseCaptureLink(captureLink(phrase))).toEqual({
    ok: true,
    value: phrase,
  });
  expect(parseCaptureLink(captureLink({ ...phrase, source: null }))).toEqual({
    ok: true,
    value: { ...phrase, source: null },
  });
  expect(parseCaptureLink(captureLink(phrase) + '&src=vk').ok).toBe(false);
  expect(
    parseCaptureLink(captureLink(phrase).replace('src=tg', 'src=unknown'))
  ).toMatchObject({ value: { source: null } });
});
test('browser fallback cannot match the native capture route', () => {
  const web = captureLink(phrase, true);
  expect(new URL(web).pathname).toBe('/capture-web');
  expect(nativeCapturePath(web)).toBeNull();
  expect(isCapturePath('/capture-web')).toBe(true);
  const intent = androidCaptureIntent(phrase);
  expect(intent).toContain('scheme=dayenglish;package=ru.dayenglish.app;');
  expect(intent).toContain('S.browser_fallback_url=' + encodeURIComponent(web));
  expect(
    nativeCapturePath(
      'dayenglish://capture' + new URL(captureLink(phrase)).search
    )
  ).toBe('/capture' + new URL(captureLink(phrase)).search);
});
describe.each([
  'https://evil.example/capture?v=1&en=word',
  'https://dayenglish.ru.evil.example/capture?v=1&en=word',
  'https://user:password@dayenglish.ru/capture?v=1&en=word',
  'https://dayenglish.ru:99/capture?v=1&en=word',
  'javascript:alert(1)',
  'https://dayenglish.ru/capture?v=1&en=%GG',
  'https://dayenglish.ru/capture?v=1&en=%00word',
  'https://dayenglish.ru/capture?v=1&en=%EF%BF%BD',
  'https://dayenglish.ru/capture?v=1&en=a&en=b',
  'https://dayenglish.ru/capture?v=1&en=word#redirect',
  'https://dayenglish.ru/capture-other?v=1&en=word',
])('rejects an invalid boundary: %s', (raw) => {
  test('invalid', () => expect(parseCaptureLink(raw).ok).toBe(false));
});
test('incomplete and unsupported links never become demo data', () => {
  expect(
    parseCaptureLink('https://dayenglish.ru/capture?ru=перевод')
  ).toMatchObject({ ok: false });
  expect(parseCaptureLink('https://dayenglish.ru/capture?v=2&en=word')).toEqual(
    { ok: false, error: 'version' }
  );
  expect(parseCaptureLink('https://dayenglish.ru/capture?v=1&en=')).toEqual({
    ok: false,
    error: 'missing',
  });
  expect(
    parseCaptureLink('https://dayenglish.ru/capture?v=1&en=' + 'a'.repeat(8000))
      .ok
  ).toBe(false);
});
test('long editable content is not truncated, but save is bounded', () => {
  const raw = { ...phrase, term: 'a'.repeat(241) };
  expect(parseCaptureLink(captureLink(raw))).toMatchObject({
    value: { term: raw.term },
  });
  expect(captureDraftError(raw)).toBe('term');
  expect(captureDraftError({ ...phrase, translation: '' })).toBe('translation');
  expect(captureDraftError({ ...phrase, context: 'a'.repeat(1001) })).toBe(
    'context'
  );
  expect(captureKey(' I’m   READY ')).toBe("i'm ready");
});
