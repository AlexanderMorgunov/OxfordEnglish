const EN: Record<string, [string, string]> = {
  Сегодня: ['Today', ''],
  'Весь курс': ['Full course', ''],
  'Учебный день': ['Study day', ''],
  Читалка: ['Reader', ''],
  'Мой словарь': ['My vocabulary', ''],
  'Перевод текста': ['Translate text', ''],
  Грамматика: ['Grammar', ''],
  Повторение: ['Review', ''],
  Библиотека: ['Library', ''],
  Прогресс: ['Progress', ''],
  Настройки: ['Settings', ''],
  Pro: ['Pro', ''],
  'О приложении': ['About', ''],
  'Обратная связь': ['Feedback', ''],
  Правило: ['Grammar topic', ''],
  'Начните с одного дня': [
    'Start with one day',
    'This is your next step. Open a day or continue one you have already started.',
  ],
  'Выберите свою точку старта': [
    'Find your starting point',
    'A short test suggests a suitable day. All the other days remain open too.',
  ],
  'Весь курс — рядом': [
    'Your course is close by',
    'Topics follow levels A1–B2. Explore the path and return to your current day.',
  ],
  'Раскройте нужный уровень': [
    'Open a level',
    'A1, A2, B1 and B2 open separately. You do not have to start with the very first topic.',
  ],
  'Откройте тему': [
    'Open a topic',
    'Choose a topic that interests you. Progress counts completed days rather than page views.',
  ],
  'Сначала познакомьтесь со словами': [
    'Meet the words first',
    'Study mode shows meanings and examples. Switch to test mode when you want to check yourself.',
  ],
  'Добавляйте слова осознанно': [
    'Choose what to review',
    'This button adds the words to review. Viewing a lesson does not add them automatically.',
  ],
  'Читайте и слушайте': [
    'Read and listen',
    'Each section has its own task. You can return to a rule or audio at any time.',
  ],
  'Закрепите в практике': [
    'Practise what you learned',
    'Answer and press Check. Try again after a mistake. AI explanations need Pro, a free trial or your own key.',
  ],
  'Незнакомое слово? Нажмите': [
    'Tap an unfamiliar word',
    'Open its meaning and pronunciation. Looking up a word does not save it to your vocabulary.',
  ],
  'Сохраните слово или фразу': [
    'Save a word or phrase',
    'Select a phrase and press Learn · save. On a phone, choose the first and last words.',
  ],
  'Разберите предложение': [
    'Understand a sentence',
    'The button after a sentence opens its translation. Ordinary translation does not require Pro.',
  ],
  'Если всё ещё трудно — AI': [
    'Ask AI for more help',
    'Clarify meaning, simplify the English or explain the grammar. These need Pro, a free trial or your own key.',
  ],
  'Настройте чтение под себя': [
    'Make reading comfortable',
    'Change text size, spacing and theme here. Bookmarks help you return to an important passage.',
  ],
  'Закрепите слова из главы': [
    'Practise words from the chapter',
    'Find saved words and chapter practice here. Starting practice is a separate action; this tour creates no exercises.',
  ],
  'Добавьте своё слово': [
    'Add a word',
    'Enter a word or phrase, check its meaning and save it. You can edit the example and details before adding it.',
  ],
  'Найдите нужную карточку': [
    'Find a card',
    'Search by word or translation. Learning, Known and Ignore help you organise your vocabulary.',
  ],
  'Работаете с целым текстом?': [
    'Working with a whole text?',
    'Open the next tab. Text translation and your personal vocabulary serve different tasks.',
  ],
  'Начните с текста': [
    'Start with your text',
    'Paste English text, then choose how to translate it. The source stays available for comparison.',
  ],
  'Словарь остаётся рядом': [
    'Your vocabulary stays close',
    'Return to saved words through My vocabulary. Opening this help does not send your text anywhere.',
  ],
  'Найдите нужное правило': [
    'Find a grammar rule',
    'Search by a topic name or a familiar word, in Russian or English.',
  ],
  'Вспоминайте, а не угадывайте': [
    'Recall before revealing',
    'Try to remember the answer before revealing it. Seeing a card does not mean you have learned the word.',
  ],
  'Оцените, как вспомнилось': [
    'Rate your recall',
    'Your rating affects the next review. If there are no cards yet, save words from a book or your vocabulary.',
  ],
  'Вернитесь к своей книге': [
    'Return to your book',
    'Continue from your saved place. You can choose a catalog book or import your own.',
  ],
  'Или добавьте новую': [
    'Or add another book',
    'Import EPUB, FB2, DOCX or PDF, or choose a catalog book without uploading a file.',
  ],
  'Смотрите на разные результаты': [
    'Look at different results',
    'Completed days, correct answers and word reviews show different aspects of learning. This is not an official CEFR assessment.',
  ],
  'От результата — к следующему шагу': [
    'Choose your next step',
    'Use the recommendations to choose an activity. Looking at statistics does not change your results.',
  ],
  'Настройте удобный интерфейс': [
    'Make the interface comfortable',
    'Preview a theme and text size. A theme is saved with Apply, rather than by viewing help.',
  ],
  'Настройки собраны по задачам': [
    'Settings follow your tasks',
    'Learning, AI, account, data and privacy have separate sections.',
  ],
  'Посмотрите, что даёт Pro': [
    'Explore Pro',
    'AI help and sync complement free study. Viewing this page does not start a subscription.',
  ],
  'Сначала прочитайте условия': [
    'Read the terms first',
    'Starting a trial is your choice. Check the duration and terms before activating it. A trial needs no card.',
  ],
  'Попробуйте маленький пример': [
    'Try a small example',
    'See how reading connects with review. This is a demonstration, not your learning progress.',
  ],
  'Выберите, с чего начать': [
    'Choose where to begin',
    'The course and library are separate ways to start learning. Pick what interests you now.',
  ],
  'Расскажите, что произошло': [
    'Tell us what happened',
    'Choose a topic and describe the steps. Do not include passwords, keys or private book passages.',
  ],
  'Проверьте перед отправкой': [
    'Check before sending',
    'A reply contact is optional. Check your message before sending; viewing help sends nothing.',
  ],
  'Тест уровня': [
    'Placement test',
    'Answer with what you know now. The result suggests a starting point without locking other days.',
  ],
  Контрольная: [
    'Checkpoint',
    'Check what you learned in this topic. Help does not answer questions or change your result.',
  ],
  'Вход и аккаунт': [
    'Account access',
    'Choose signup or sign-in with a username and password. You can set up recovery later in your account.',
  ],
  Поддержка: [
    'Support',
    'Find ways to support the project here. The amount and terms appear before payment.',
  ],
  'Авторы и материалы': [
    'Credits',
    'Find material sources and author credits here.',
  ],
  Конфиденциальность: [
    'Privacy',
    'Read how data is handled before using the service.',
  ],
  'Оферта и контакты': [
    'Terms and contacts',
    'Find terms of use, payment conditions and seller contacts here.',
  ],
  Обучение: [
    'Learning',
    'Choose a level and starting point. Viewing help does not change your study day.',
  ],
  'AI-помощник': [
    'AI assistant',
    'Manage AI access and your provider settings. A personal key is optional with active Pro or a free trial.',
  ],
  'Аккаунт и подписка': [
    'Account and subscription',
    'Manage sign-in, Pro and devices. Viewing help creates no account and starts no trial.',
  ],
  'Данные и синхронизация': [
    'Data and sync',
    'Manage sync and backups here. Export and deletion require separate actions.',
  ],
  'Приватность и приложение': [
    'Privacy and app',
    'Manage analytics, check your app version and find documents.',
  ],
  'Другие настройки — рядом': [
    'Other settings are close by',
    'Return to the settings list to choose another task.',
  ],
  'Разберите правило на примерах': [
    'Learn the rule from examples',
    'Read the explanation and compare English examples. You can return to the topic list without losing learning progress.',
  ],
};

export function englishStep(title: string): [string, string] {
  return EN[title] ?? [title, ''];
}
