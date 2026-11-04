import type { LoadedPack } from '@/content/loader';
import type { GrammarArticle, LocalizedText } from '@/content/schema';
import type { CheckpointResult } from '@/db/db';
import { validTimestamp } from './validation';

export const percentage = (correct: number, total: number) =>
  total > 0 ? `${Math.round((correct / total) * 100)}%` : '—';
export function duration(seconds: number, ru: boolean) {
  if (seconds > 0 && seconds < 30) return ru ? '< 1 мин' : '< 1 min';
  const minutes = Math.round(seconds / 60),
    hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return hours
    ? ru
      ? `${hours} ч ${rest} мин`
      : `${hours}h ${rest}m`
    : ru
      ? `${minutes} мин`
      : `${minutes} min`;
}
export function displayDate(key: string, ru: boolean, long = false) {
  const month = key.length === 7;
  return new Date(`${key}${month ? '-01' : ''}T12:00:00Z`).toLocaleDateString(
    ru ? 'ru-RU' : 'en-US',
    {
      day: month ? undefined : 'numeric',
      month: long ? 'long' : 'short',
      year: long ? 'numeric' : undefined,
      timeZone: 'UTC',
    }
  );
}
export function checkpointScore(result: CheckpointResult) {
  return Number.isInteger(result.total) &&
    result.total > 0 &&
    Number.isInteger(result.score) &&
    result.score >= 0 &&
    result.score <= result.total
    ? percentage(result.score, result.total)
    : '—';
}
export function checkpointDate(timestamp: number, ru: boolean) {
  return validTimestamp(timestamp)
    ? new Date(timestamp).toLocaleDateString(ru ? 'ru-RU' : 'en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ru
      ? 'Дата неизвестна'
      : 'Date unknown';
}
export function skillKind(tag: string) {
  return tag.startsWith('grammar.')
    ? 'grammar'
    : tag.startsWith('vocab.')
      ? 'vocab'
      : tag.startsWith('listening.')
        ? 'listening'
        : 'other';
}
const ALIASES: Record<string, string> = {
  be: 'verb-be',
  'verb-ing-vs-to': 'gerund-infinitive',
  'past-simple.regular': 'past-simple',
  'past-simple.irregular': 'past-simple',
  'past-simple.negative': 'past-simple',
  'past-simple.question': 'past-simple',
  'prepositions-time': 'time-prepositions',
  must: 'modals-obligation',
  'have-to': 'modals-obligation',
  should: 'modals-obligation',
  'might-may': 'modals-possibility',
  'going-to': 'future-forms',
  will: 'future-forms',
  'will-vs-going-to': 'future-forms',
  'present-continuous-future': 'future-forms',
  'zero-conditional': 'conditionals-0-1',
  'first-conditional': 'conditionals-0-1',
};
export function skillPresentation(
  tag: string,
  pack: LoadedPack | null
): { title: LocalizedText; rule: GrammarArticle | null } {
  const key = tag.replace(/^grammar\./, '');
  const rule =
    pack?.grammar.find(
      (article) => article.id === key || article.id === ALIASES[key]
    ) ?? null;
  if (rule) return { title: rule.title, rule };
  const labels: Record<string, LocalizedText> = {
    'listening.gist': {
      ru: 'Основной смысл на слух',
      en: 'Listening for gist',
    },
    'listening.detail': { ru: 'Детали на слух', en: 'Listening for detail' },
    'listening.dictation': { ru: 'Диктант', en: 'Dictation' },
    'reading.gist': { ru: 'Основной смысл текста', en: 'Reading for gist' },
    'reading.detail': { ru: 'Детали текста', en: 'Reading for detail' },
    'vocab.daily': { ru: 'Повседневные слова', en: 'Everyday vocabulary' },
    'vocab.work': { ru: 'Работа', en: 'Work vocabulary' },
    'vocab.dev': { ru: 'Разработка', en: 'Development vocabulary' },
    'reader.vocab': { ru: 'Слова из книг', en: 'Vocabulary from books' },
    pronunciation: { ru: 'Произношение', en: 'Pronunciation' },
    'writing.sentence': {
      ru: 'Составление предложений',
      en: 'Writing sentences',
    },
    'writing.translation': {
      ru: 'Письменный перевод',
      en: 'Written translation',
    },
  };
  const readable = tag.replace(/^[^.]+\./, '').replaceAll(/[.-]/g, ' ');
  return { title: labels[tag] ?? { en: readable, ru: readable }, rule: null };
}
