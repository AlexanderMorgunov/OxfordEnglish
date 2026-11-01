import { create } from 'zustand';
import { subscribeDataScope } from '@/features/account/dataScope';
import type { AppIconName } from '@/shared/ui/AppIcon';
import type { FeedbackCategory, SubmitResult } from './service';

export const CATEGORIES: {
  id: FeedbackCategory;
  ru: string;
  en: string;
  icon: AppIconName;
  hint: [string, string];
  placeholder: [string, string];
}[] = [
  {
    id: 'broken',
    ru: 'Что-то сломалось',
    en: 'Something’s broken',
    icon: 'settings',
    hint: [
      'Где это произошло и что вы хотели сделать?',
      'Where did this happen, and what were you trying to do?',
    ],
    placeholder: [
      'Например: в уроке A2 нажимаю на озвучку, но звука нет.',
      'For example: tapping audio in an A2 lesson does not play any sound.',
    ],
  },
  {
    id: 'lesson-error',
    ru: 'Ошибка в уроке',
    en: 'Mistake in a lesson',
    icon: 'grammar',
    hint: [
      'Укажите урок, задание и что кажется неверным.',
      'Include the lesson, exercise and what seems incorrect.',
    ],
    placeholder: [
      'Например: в уроке A1, день 5, ответ в задании не совпадает с объяснением.',
      'For example: in A1 day 5, the answer does not match the explanation.',
    ],
  },
  {
    id: 'idea',
    ru: 'Есть идея',
    en: 'I have an idea',
    icon: 'pro',
    hint: [
      'Что хотите делать удобнее и в какой ситуации?',
      'What would you like to do more easily, and when?',
    ],
    placeholder: [
      'Например: хочу быстрее находить слова, добавленные из книги.',
      'For example: I want to find words saved from my book more easily.',
    ],
  },
  {
    id: 'other',
    ru: 'Другое',
    en: 'Something else',
    icon: 'feedback',
    hint: [
      'Расскажите, чем можем помочь. Пары предложений достаточно.',
      'Tell us how we can help. A couple of sentences is enough.',
    ],
    placeholder: [
      'Напишите, что хотите рассказать.',
      'What would you like to tell us?',
    ],
  },
];
export const MIN_DETAIL = 10;
export type Draft = {
  category: FeedbackCategory | null;
  text: string;
  email: string;
  submissionId: string;
};
const blank = (): Draft => ({
  category: null,
  text: '',
  email: '',
  submissionId: crypto.randomUUID(),
});
let requestRevision = 0;
export function beginFeedbackAttempt(): () => boolean {
  const revision = ++requestRevision;
  return () => revision === requestRevision;
}
export const useFeedbackDraft = create<{
  draft: Draft;
  receipt: SubmitResult | null;
  edit: (patch: Partial<Pick<Draft, 'category' | 'text' | 'email'>>) => void;
  receive: (receipt: SubmitResult | null) => void;
  reset: () => void;
}>((set, get) => ({
  draft: blank(),
  receipt: null,
  edit: (patch) => {
    requestRevision += 1;
    set((state) => ({ draft: { ...state.draft, ...patch } }));
  },
  receive: (receipt) => {
    if (
      !receipt ||
      receipt.item.submissionId !== get().receipt?.item.submissionId
    )
      requestRevision += 1;
    set({ receipt });
  },
  reset: () => {
    requestRevision += 1;
    set({ draft: blank(), receipt: null });
  },
}));
subscribeDataScope((change) => {
  if (change === 'reset') useFeedbackDraft.getState().reset();
});

export function validateFeedback(
  draft: Draft
): ('category' | 'text' | 'email')[] {
  const errors: ('category' | 'text' | 'email')[] = [];
  if (!draft.category) errors.push('category');
  if (draft.text.trim().length < MIN_DETAIL) errors.push('text');
  if (
    draft.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())
  )
    errors.push('email');
  return errors;
}
