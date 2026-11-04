export function safeAccessReturn(value: string | null, origin: string): string {
  const fallback = '/settings/account';
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\') || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return fallback;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.pathname.startsWith('/account') ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}
