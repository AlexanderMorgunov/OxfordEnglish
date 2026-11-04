export function safeSettingsReturn(value: string | null): string | null {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin &&
      !url.pathname.startsWith('/settings')
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}
