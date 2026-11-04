import type { UiLang } from '@/features/i18n/uiLang';
import { englishStep } from './translations';

export type TourStep = {
  title: string;
  body: string;
  selector: string;
  media: string[];
  text: string;
};
export type TourDefinition = {
  key: string;
  title: string;
  auto?: boolean;
  steps: TourStep[];
};
export type ResolvedStep = TourStep & { element: HTMLElement };

const step = (
  title: string,
  body: string,
  selector: string,
  media: string[] = [],
  text = ''
): TourStep => ({
  title,
  body,
  selector,
  media,
  text,
});

const tours: Record<string, Omit<TourDefinition, 'key'>> = {
  today: {
    title: 'Сегодня',
    steps: [
      step(
        'Начните с одного дня',
        'Здесь ваш следующий шаг. Откройте день или продолжите тот, который уже начали.',
        '.course-resume',
        ['today-continue']
      ),
      step(
        'Выберите свою точку старта',
        'Короткий тест предложит подходящий день. Все остальные дни тоже открыты.',
        'main a[href^="/placement"]'
      ),
      step(
        'Весь курс — рядом',
        'Темы собраны по уровням A1–B2. Можно посмотреть маршрут и вернуться к своему дню.',
        'main a[href^="/syllabus"]'
      ),
    ],
  },
  syllabus: {
    title: 'Весь курс',
    steps: [
      step(
        'Раскройте нужный уровень',
        'A1, A2, B1 и B2 раскрываются отдельно. Начинать строго с первой темы не обязательно.',
        '.course-level-toggle'
      ),
      step(
        'Откройте тему',
        'Выберите интересную тему. Прогресс показывает завершённые дни, а не просто просмотренные страницы.',
        '.course-topic'
      ),
    ],
  },
  lesson: {
    title: 'Учебный день',
    auto: true,
    steps: [
      step(
        'Сначала познакомьтесь со словами',
        'В режиме «учить» видны перевод и пример. Включите «тест», когда захотите проверить себя.',
        '[data-onboarding="lesson-vocabulary"] [role="radiogroup"]',
        ['unit-vocabulary']
      ),
      step(
        'Добавляйте слова осознанно',
        'Эта кнопка отправит слова в повторение. Просмотр урока сам по себе ничего туда не добавляет.',
        '[data-onboarding="lesson-add-words"]'
      ),
      step(
        'Читайте и слушайте',
        'В каждом разделе — своя задача. К прочитанному правилу и аудио можно вернуться в любой момент.',
        '[data-onboarding="lesson-reading"] h2, [data-onboarding="lesson-listening"] h2',
        ['unit-reading']
      ),
      step(
        'Закрепите в практике',
        'Ответьте и нажмите «Проверить». Ошибка — повод попробовать ещё раз. AI-разбор доступен с Pro, trial или своим ключом.',
        '[data-onboarding="lesson-practice"] h2',
        ['unit-practice']
      ),
    ],
  },
  reader: {
    title: 'Читалка',
    auto: true,
    steps: [
      step(
        'Незнакомое слово? Нажмите',
        'Откроются значение и озвучка. Просмотр перевода не добавляет слово в словарь.',
        '[data-reader-text] [data-para] button[data-widx]',
        ['reader-word']
      ),
      step(
        'Сохраните слово или фразу',
        'Выделите фразу и нажмите «Учу · сохранить». На телефоне выберите первое и последнее слово.',
        '[data-reader-text] [data-para]',
        ['reader-save']
      ),
      step(
        'Разберите предложение',
        'Значок после предложения открывает перевод. Для обычного перевода Pro не нужен.',
        '[data-reader-text] [data-para]',
        ['reader-translate']
      ),
      step(
        'Если всё ещё трудно — AI',
        'Можно уточнить смысл, упростить английский или объяснить грамматику. Нужны Pro, trial или свой ключ.',
        '[data-reader-text] [data-para]',
        ['reader-context', 'reader-simplify', 'reader-grammar']
      ),
      step(
        'Настройте чтение под себя',
        'Размер, интервалы и тема меняются здесь. Закладки рядом помогут вернуться к важному месту.',
        '[data-onboarding="reader-appearance"]',
        ['reader-tools']
      ),
      step(
        'Закрепите слова из главы',
        'Здесь собраны слова и практика по прочитанному. Это отдельное действие — тур не создаёт упражнения.',
        '.rd-chapter-finish button',
        ['reader-practice']
      ),
    ],
  },
  vocabulary: {
    title: 'Мой словарь',
    steps: [
      step(
        'Добавьте своё слово',
        'Введите слово или фразу, проверьте значение и сохраните. Пример и детали можно уточнить перед добавлением.',
        '[data-onboarding="vocabulary-add"]',
        ['vocab-add']
      ),
      step(
        'Найдите нужную карточку',
        'Ищите по слову или переводу. Отметки «Учу», «Знаю» и «Игнор» помогают разбирать словарь.',
        '.vc-toolbar, .vc-search, .vc-page input',
        ['vocab-find']
      ),
      step(
        'Работаете с целым текстом?',
        'Откройте соседнюю вкладку. Перевод текста и ваш личный словарь — разные задачи.',
        'main a[href^="/vocabulary/text"]'
      ),
    ],
  },
  text: {
    title: 'Перевод текста',
    steps: [
      step(
        'Начните с текста',
        'Вставьте английский текст, затем выберите перевод. Исходник останется доступен для сравнения.',
        'main textarea'
      ),
      step(
        'Словарь остаётся рядом',
        'К сохранённым словам можно вернуться через «Мой словарь». Открытие подсказок не отправляет ваш текст.',
        'main a[href^="/vocabulary"]:not([href^="/vocabulary/"])'
      ),
    ],
  },
  grammar: {
    title: 'Грамматика',
    steps: [
      step(
        'Найдите нужное правило',
        'Введите название или знакомое слово. Можно искать по-русски и по-английски.',
        '.grammar-page input',
        ['grammar-find']
      ),
      step(
        'Откройте тему',
        'Уровень и короткое описание помогают выбрать правило. В статье — примеры и объяснения.',
        '.grammar-card'
      ),
    ],
  },
  review: {
    title: 'Повторение',
    steps: [
      step(
        'Вспоминайте, а не угадывайте',
        'Сначала попробуйте вспомнить ответ, затем откройте его. Показ карточки ещё не означает, что слово выучено.',
        '.rv-empty, .rv-session, .rv-hero, .rv-page h1',
        ['review-answer']
      ),
      step(
        'Оцените, как вспомнилось',
        'Оценка влияет на следующее повторение. Если карточек пока нет, добавьте слова из читалки или словаря.',
        '.rv-page h1',
        ['review-return']
      ),
    ],
  },
  library: {
    title: 'Библиотека',
    steps: [
      step(
        'Вернитесь к своей книге',
        'Продолжите с сохранённого места. Можно выбрать книгу из каталога или добавить свою.',
        '.library-continue, .library-head',
        ['library-open']
      ),
      step(
        'Или добавьте новую',
        'Импортируйте EPUB, FB2, DOCX или PDF. В каталоге можно выбрать книгу без своего файла.',
        '.library-head button, .library-head a, .library-nav',
        ['library-import']
      ),
    ],
  },
  progress: {
    title: 'Прогресс',
    steps: [
      step(
        'Смотрите на разные результаты',
        'Завершённые дни, верные ответы и повторение слов показывают разные стороны учёбы. Это не официальный уровень CEFR.',
        '.pr-header',
        ['progress-read']
      ),
      step(
        'От результата — к следующему шагу',
        'Используйте рекомендации страницы, чтобы выбрать занятие. Просмотр статистики не меняет результаты.',
        '.pr-resume'
      ),
    ],
  },
  settings: {
    title: 'Настройки',
    steps: [
      step(
        'Настройте удобный интерфейс',
        'Примерьте тему и размер текста. Тема сохраняется после «Применить», а не после просмотра подсказки.',
        '.appearance-settings, .settings-panel, .settings-menu',
        ['settings-theme']
      ),
      step(
        'Настройки собраны по задачам',
        'Обучение, AI, аккаунт, данные и приватность находятся в отдельных разделах.',
        '.settings-menu, .settings-top'
      ),
    ],
  },
  pro: {
    title: 'Pro',
    steps: [
      step(
        'Посмотрите, что даёт Pro',
        'AI-помощь и синхронизация дополняют бесплатную учёбу. Просмотр этой страницы не запускает подписку.',
        'main h1, main .access-flow h2'
      ),
      step(
        'Сначала прочитайте условия',
        'Пробный период подключается только вашим действием. Перед подключением проверьте срок и условия. Карта для пробного периода не нужна.',
        '[data-onboarding="pro-subscription"]'
      ),
    ],
  },
  about: {
    title: 'О приложении',
    steps: [
      step(
        'Попробуйте маленький пример',
        'Здесь можно увидеть связку чтения и повторения. Это демонстрация, а не ваш учебный прогресс.',
        '.ab-live-demo'
      ),
      step(
        'Выберите, с чего начать',
        'Учебный путь и библиотека — два самостоятельных входа в обучение. Начните с того, что интереснее сейчас.',
        '.ab-hero .ab-primary, .ab-hero a'
      ),
    ],
  },
  feedback: {
    title: 'Обратная связь',
    steps: [
      step(
        'Расскажите, что произошло',
        'Выберите тему и опишите шаги. Не добавляйте пароли, ключи или личные тексты из книг.',
        'main textarea'
      ),
      step(
        'Проверьте перед отправкой',
        'Контакт для ответа необязателен. Проверьте текст перед отправкой. Просмотр подсказки ничего не отправляет.',
        '.fb-feedback-panel'
      ),
    ],
  },
};

const documents: Record<string, [string, string]> = {
  placement: [
    'Тест уровня',
    'Отвечайте так, как знаете сейчас. Результат предложит точку старта, а не закроет остальные дни.',
  ],
  checkpoint: [
    'Контрольная',
    'Проверьте материал темы. Тур не отвечает на вопросы и не меняет результат.',
  ],
  account: [
    'Вход и аккаунт',
    'Выберите создание аккаунта или вход. Используйте логин и пароль. Восстановление можно настроить позже в аккаунте.',
  ],
  support: [
    'Поддержка',
    'Здесь способы поддержать проект. Условия и сумма показываются перед оплатой.',
  ],
  credits: [
    'Авторы и материалы',
    'Здесь указаны источники и авторы материалов приложения.',
  ],
  privacy: [
    'Конфиденциальность',
    'Здесь описано обращение с данными. Прочитайте условия перед использованием сервиса.',
  ],
  terms: [
    'Оферта и контакты',
    'Здесь условия использования, оплаты и контакты продавца.',
  ],
};

function definitionFor(path: string): TourDefinition | null {
  let key = path.split('/')[1] || 'today';
  if (/^\/course\/[^/]+\/day\//.test(path)) key = 'lesson';
  else if (/^\/library\/(?!catalog\/?$)[^/]+/.test(path)) key = 'reader';
  else if (key === 'library') key = 'library';
  else if (path === '/vocabulary/text') key = 'text';
  else if (
    key === 'settings' &&
    path !== '/settings' &&
    path !== '/settings/interface'
  ) {
    const sections: Record<string, [string, string]> = {
      learning: [
        'Обучение',
        'Здесь можно выбрать уровень и точку старта. Просмотр тура не меняет учебный день.',
      ],
      ai: [
        'AI-помощник',
        'Здесь доступ к AI и настройки своего провайдера. Свой ключ необязателен для активного Pro или пробного периода.',
      ],
      account: [
        'Аккаунт и подписка',
        'Здесь вход, Pro и устройства. Просмотр подсказки не создаёт аккаунт и не запускает trial.',
      ],
      data: [
        'Данные и синхронизация',
        'Здесь синхронизация и резервная копия. Экспорт и удаление выполняются отдельными действиями.',
      ],
      privacy: [
        'Приватность и приложение',
        'Здесь настройки статистики, версия приложения и ссылки на документы.',
      ],
    };
    const selected = sections[path.split('/')[2] ?? ''];
    if (selected)
      return {
        key: 'settings-' + path.split('/')[2],
        title: selected[0],
        steps: [
          step(
            selected[0],
            selected[1],
            '.settings-panel-header, .settings-menu'
          ),
          step(
            'Другие настройки — рядом',
            'Вернитесь к списку разделов настроек, чтобы выбрать другую задачу.',
            '.settings-mobile-back, .settings-menu, .settings-top'
          ),
        ],
      };
  } else if (key === 'grammar' && path !== '/grammar')
    return {
      key: 'grammar-article',
      title: 'Правило',
      steps: [
        step(
          'Разберите правило на примерах',
          'Читайте объяснение и сравнивайте английские примеры. К списку тем можно вернуться без потери учебного прогресса.',
          'main h1, main .access-flow h2'
        ),
      ],
    };
  const tour = tours[key];
  if (tour) return { key, ...tour };
  const info = documents[key];
  return info
    ? {
        key,
        title: info[0],
        steps: [step(info[0], info[1], 'main h1, main .access-flow h2')],
      }
    : null;
}

export function resolveSteps(
  doc: Document,
  tour: TourDefinition
): ResolvedStep[] {
  return tour.steps.flatMap((item) => {
    const element = [...doc.querySelectorAll<HTMLElement>(item.selector)].find(
      (node) =>
        node.getClientRects().length &&
        !node.closest('[hidden],dialog:not([open])') &&
        (!item.text || node.textContent?.trim() === item.text)
    );
    return element ? [{ ...item, element }] : [];
  });
}

export function tourFor(path: string, lang: UiLang): TourDefinition | null {
  const tour = definitionFor(path);
  if (!tour || lang === 'ru') return tour;
  return {
    ...tour,
    title: englishStep(tour.title)[0],
    steps: tour.steps.map((item) => {
      const [title, body] = englishStep(item.title);
      return { ...item, title, body };
    }),
  };
}
