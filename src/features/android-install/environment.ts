import { isNativePlatform } from '@/shared/lib/platform';
import { isIOS, isStandalone } from '@/features/pwa/install';

export type InstallEnvironment =
  'native' | 'standalone' | 'android' | 'ios' | 'other';

export function installEnvironment(): InstallEnvironment {
  if (isNativePlatform()) return 'native';
  if (isStandalone()) return 'standalone';
  if (isIOS()) return 'ios';
  return /Android/i.test(navigator.userAgent) &&
    /Mobile/i.test(navigator.userAgent)
    ? 'android'
    : 'other';
}
