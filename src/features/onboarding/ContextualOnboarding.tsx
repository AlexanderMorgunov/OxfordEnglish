import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { ContextualTour } from './controller';
import './onboarding.css';

export function ContextualOnboarding() {
  const { pathname, search } = useLocation();
  const lang = useUiLang((s) => s.lang);
  const controller = useRef<ContextualTour | null>(null);
  useEffect(() => {
    const tour = new ContextualTour();
    controller.current = tour;
    return () => {
      tour.destroy();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.update(pathname, lang);
  }, [pathname, search, lang]);
  return null;
}
