import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { isCapturePath } from './links';

export function nativeCapturePath(raw: string): string | null {
  if (raw.length > 8000) return null;
  try {
    const url = new URL(raw);
    const web =
      url.protocol === 'https:' &&
      url.hostname === 'dayenglish.ru' &&
      isCapturePath(url.pathname) &&
      !url.pathname.startsWith('/capture-web');
    const custom =
      url.protocol === 'dayenglish:' &&
      url.hostname === 'capture' &&
      (url.pathname === '' || url.pathname === '/');
    if (
      (!web && !custom) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
    return '/capture' + url.search;
  } catch {
    return null;
  }
}

export async function connectCaptureLinks(
  navigate: (path: string) => Promise<void>
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  let active = true,
    received = false;
  const open = async (url: string) => {
    const path = nativeCapturePath(url);
    if (active && path) await navigate(path);
  };
  const listener = await App.addListener('appUrlOpen', (event) => {
    received = true;
    void open(event.url).catch(() => {});
  });
  try {
    const launch = await App.getLaunchUrl();
    if (!received && launch?.url) await open(launch.url);
  } catch {
    /* Normal startup must remain available if native URL delivery fails. */
  }
  return () => {
    active = false;
    void listener.remove();
  };
}
