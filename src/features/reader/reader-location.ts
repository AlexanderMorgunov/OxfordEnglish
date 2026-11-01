import { navigationInsets } from '@/shared/lib/navigation-insets';
import { toSentences } from './parse/text';

export function currentReadingLocation(
  root: HTMLElement,
  paragraphs: string[],
  insets = navigationInsets()
): { paragraph: number; sentence: number; text: string } | null {
  const end = window.innerHeight - insets.bottom;
  const visible = (element: HTMLElement) =>
    [...element.getClientRects()].some(
      (rect) => rect.height > 0 && rect.bottom > insets.top && rect.top < end
    );
  const sentences = [...root.querySelectorAll<HTMLElement>('[data-sent]')];
  let target = sentences.find(visible);
  const bounds = root.getBoundingClientRect();
  if (!target && sentences.length) {
    if (bounds.bottom <= insets.top) target = sentences.at(-1);
    else if (bounds.top >= end) target = sentences[0];
  }
  if (target) {
    const [paragraph, sentence] = (target.dataset.sent ?? '')
      .split(':')
      .map(Number);
    if (
      paragraph != null &&
      sentence != null &&
      Number.isInteger(paragraph) &&
      Number.isInteger(sentence)
    ) {
      const text = toSentences(paragraphs[paragraph] ?? '')[sentence];
      if (text) return { paragraph, sentence, text };
    }
  }
  const paragraph = [...root.querySelectorAll<HTMLElement>('[data-para]')].find(
    visible
  );
  const index = Number(paragraph?.dataset.para);
  const text = Number.isInteger(index)
    ? toSentences(paragraphs[index] ?? '')[0]
    : undefined;
  return text ? { paragraph: index, sentence: 0, text } : null;
}
