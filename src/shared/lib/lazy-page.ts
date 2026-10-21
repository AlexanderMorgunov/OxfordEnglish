import { lazy, type ComponentType } from 'react';
import { PageLoadError } from '@/shared/lib/page-diagnostics';

export function lazyPage<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (error) {
      throw new PageLoadError(error);
    }
  });
}
