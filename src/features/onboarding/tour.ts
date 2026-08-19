import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { track } from '@/features/analytics/analytics';
import type { UiLang } from '@/features/i18n/uiLang';

const SEEN_KEY = 'onboarding.seen';

export function onboardingSeen(): boolean {
  return localStorage.getItem(SEEN_KEY) === '1';
}

export function markOnboardingSeen(): void {
  localStorage.setItem(SEEN_KEY, '1');
}

type TourStep = { el: string; title: [ru: string, en: string]; body: [ru: string, en: string] };

const STEPS: TourStep[] = [
  {
    el: '[data-tour="start"]',
    title: ['С чего начать', 'Where to start'],
    body: [
      'Пятиминутный тест определит ваш уровень и подскажет, с какого дня начать. Каждый день — грамматика, чтение, аудирование и практика.',
      'A five-minute test finds your level and the day to start from. Each day is grammar, reading, listening and practice.',
    ],
  },
  {
    el: '[data-tour="nav-review"]',
    title: ['Повторение', 'Review'],
    body: [
      'Слова и правила, в которых вы ошибались, возвращаются здесь — интервальными карточками, чтобы закрепить надолго.',
      'Words and rules you missed come back here as spaced-repetition cards, so they stick.',
    ],
  },
  {
    el: '[data-tour="nav-library"]',
    title: ['Читалка', 'Reader'],
    body: [
      'Импортируйте свою книгу (EPUB/FB2/DOCX) или выберите из каталога. Тапните слово — перевод и карточка; из главы собираются упражнения.',
      'Import your own book (EPUB/FB2/DOCX) or pick one from the catalog. Tap a word for a translation and a card; exercises are built from each chapter.',
    ],
  },
  {
    el: '[data-tour="nav-settings"]',
    title: ['Настройки', 'Settings'],
    body: [
      'Язык интерфейса, уровень, резервная копия прогресса и опциональный AI-помощник по вашему ключу.',
      'Interface language, level, a backup of your progress, and an optional AI helper with your own key.',
    ],
  },
];

export function startTour(lang: UiLang): void {
  const ru = lang === 'ru';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const steps: DriveStep[] = STEPS.filter((s) => document.querySelector(s.el)).map((s) => ({
    element: s.el,
    popover: {
      title: ru ? s.title[0] : s.title[1],
      description: ru ? s.body[0] : s.body[1],
    },
  }));
  if (steps.length === 0) return;

  markOnboardingSeen();
  void track('onboarding_start');

  const last = steps.length - 1;
  let reachedLast = false;
  try {
    const d = driver({
      animate: !reduce,
      showProgress: true,
      allowClose: true,
      overlayColor: '#0a0b10',
      nextBtnText: ru ? 'Далее' : 'Next',
      prevBtnText: ru ? 'Назад' : 'Back',
      doneBtnText: ru ? 'Готово' : 'Done',
      steps,
      onHighlighted: () => {
        if (d.getActiveIndex() === last) reachedLast = true;
      },
      onDestroyed: () => {
        void track('onboarding_end', { completed: reachedLast });
      },
    });
    d.drive();
  } catch {
    // A tour glitch must never take down the dashboard; it's already marked seen.
  }
}
