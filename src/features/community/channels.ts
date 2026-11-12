export const SOCIAL_CHANNELS = [
  {
    id: 'telegram',
    url: 'https://t.me/dayenglishru',
    ru: 'Telegram',
    en: 'Telegram',
    accountRu: 'Канал DayEnglish',
    accountEn: 'DayEnglish channel',
    officialRu: 'Официальный',
    descriptionRu:
      'Короткие разборы и практика по английскому, а ещё — обновления DayEnglish.',
    descriptionEn:
      'Short English explanations and practice, plus DayEnglish updates.',
  },
  {
    id: 'vk',
    url: 'https://vk.ru/club242958850',
    ru: 'ВКонтакте',
    en: 'VK',
    accountRu: 'Сообщество DayEnglish',
    accountEn: 'DayEnglish community',
    officialRu: 'Официальное',
    descriptionRu:
      'Полезные выражения, задания и новости приложения — в привычной ленте.',
    descriptionEn:
      'Useful expressions, activities and app news in your usual feed.',
  },
] as const;

export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];
