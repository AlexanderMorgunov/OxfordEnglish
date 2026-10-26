import { normalizeText } from '@/features/reader/parse/text';
import { translateText, type TranslationProgress } from './translate';
import { translationChunks } from './translation-chunks';
import { aiTranslate } from '@/features/ai/functions';
import { managedAiAvailable, planUnreadable } from '@/features/account/entitlement';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';
import type { AiConfig } from '@/features/ai/provider';
import { captureAiScope, type AiPath } from '@/features/ai/route';
import { abortReason } from '@/shared/lib/deadline';

export const WORKBENCH_LIMIT = 2000;
export type TextMode = 'free' | 'ai';
export type TextIssue = 'empty' | 'too-long' | 'not-english';
export type PassageProgress = TranslationProgress;
export type PassageResume = Map<string, { text: string; path?: AiPath | 'free' }>;

export function prepareText(raw: string): { text: string; issue?: TextIssue } {
  const text = normalizeText(raw);
  if (!text) return { text, issue: 'empty' };
  if (raw.length > WORKBENCH_LIMIT) return { text, issue: 'too-long' };
  const latin = text.match(/[a-z]/gi)?.length ?? 0;
  const cyrillic = text.match(/[а-яё]/gi)?.length ?? 0;
  if (!latin || cyrillic > latin) return { text, issue: 'not-english' };
  return { text };
}

export const aiTextParts = (text: string): number =>
  text.split(/\n{2,}/).reduce((count, paragraph) => count + translationChunks(paragraph, 300).length, 0);

export const passageTextParts = (text: string, mode: TextMode): number =>
  normalizeText(text).split(/\n{2,}/).reduce((count, paragraph) => count + translationChunks(paragraph, mode === 'ai' ? 300 : 500).length, 0);

export async function translatePassage(text: string, opts: {
  mode: TextMode; config: AiConfig | null; signal: AbortSignal;
  cacheOnly?: boolean;
  onProgress?: (text: string, paths: AiPath[], progress: PassageProgress) => void;
  resume?: PassageResume;
}): Promise<string> {
  const prepared = prepareText(text);
  if (prepared.issue) throw new Error('Invalid text');
  const current = captureDataScope();
  const controller = new AbortController();
  const abort = () => controller.abort();
  opts.signal.addEventListener('abort', abort, { once: true });
  if (opts.signal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), opts.mode === 'ai' ? 180000 : 30000);
  const aiActive = captureAiScope(controller.signal);
  const requireActive = () => {
    requireDataScope(current);
    if (opts.mode === 'ai') aiActive();
    else if (controller.signal.aborted) throw abortReason(controller.signal);
  };
  try {
    requireActive();
    if (opts.mode === 'free') {
      const resume = new Map([...opts.resume ?? []].filter(([, saved]) => saved.path === 'free').map(([part, saved]) => [part, saved.text]));
      const result = await translateText(prepared.text, {
        mode: 'passage', signal: controller.signal, resume,
        onProgress: (translated, progress) => {
          requireActive();
          for (const [part, value] of resume) opts.resume?.set(part, { text: value, path: 'free' });
          opts.onProgress?.(translated, [], progress);
        },
      });
      requireActive();
      if (!result) throw new Error('Translation unavailable');
      return result;
    }
    let path: AiPath = managedAiAvailable() || planUnreadable() ? 'managed' : 'byok';
    const sources = new Set<AiPath>();
    const cachePrefix = 'text-workbench:ai ';
    requireActive();
    const total = passageTextParts(prepared.text, 'ai');
    let completed = 0;
    opts.onProgress?.('', [], { completed, total });
    const paragraphs: string[] = [];
    for (const paragraph of prepared.text.split(/\n{2,}/)) {
      const output: string[] = [];
      for (const part of translationChunks(paragraph, 300)) {
        requireActive();
        const saved = opts.resume?.get(part);
        if (saved && saved.path !== 'free') {
          output.push(saved.text);
          if (saved.path) sources.add(saved.path);
        } else {
          let actual: AiPath | undefined;
          const translated = await aiTranslate(opts.config, part, {
            signal: controller.signal, path, cachePrefix, cacheOnly: opts.cacheOnly,
            onSource: (source, cached) => {
              actual = source;
              sources.add(source);
              if (source === 'byok' && !cached) path = 'byok';
            },
          });
          requireActive();
          output.push(translated);
          opts.resume?.set(part, { text: translated, path: actual });
        }
        requireActive();
        completed += 1;
        opts.onProgress?.([...paragraphs, output.join(' ')].join('\n\n'), [...sources], { completed, total });
      }
      paragraphs.push(output.join(' '));
    }
    requireActive();
    return paragraphs.join('\n\n');
  } finally {
    clearTimeout(timeout);
    opts.signal.removeEventListener('abort', abort);
  }
}
