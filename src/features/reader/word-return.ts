import { create } from 'zustand';
import { z } from 'zod';
import { getDataOwnerRevision, subscribeDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { readPending } from '@/features/account/billing';

const KEY = 'reader.wordReturn';
const TTL = 3 * 86_400_000;
const common = z.object({
  id: z.string(), pathname: z.string(), word: z.string(), manualDraft: z.string().max(2000).nullable(),
  accountId: z.string().nullable(), owner: z.number(), createdAt: z.number(),
  phase: z.enum(['offer', 'ready', 'checkout']), invoiceId: z.string().optional(),
});
const targetSchema = z.discriminatedUnion('kind', [
  common.extend({ kind: z.literal('book'), pathname: z.string().regex(/^\/library\/[^?#\\]+$/),
    bookKey: z.string(), chapterId: z.string(), tokenId: z.string().regex(/^\d+:\d+:\d+$/) }),
  common.extend({ kind: z.literal('lesson'), pathname: z.string().regex(/^\/course\/[^/?#\\]+\/day\/[^/?#\\]+$/),
    sectionId: z.string(), blockId: z.string(), tokenIndex: z.number().int().nonnegative() }),
]);
export type WordReturn = z.infer<typeof targetSchema>;
export type LessonWordTarget = { sectionId: string; blockId: string; tokenIndex: number };
type ReturnInput = Pick<WordReturn, 'pathname' | 'word' | 'manualDraft'>;
export const lessonWordKey = (target: LessonWordTarget) => JSON.stringify([target.sectionId, target.blockId, target.tokenIndex]);

export const useWordReturn = create<{ entry: WordReturn | null }>(() => ({ entry: null }));

function forgetStored() {
  try { localStorage.removeItem(KEY); } catch { /* Memory ownership still fences this session. */ }
}

export function discardWordReturn() {
  forgetStored();
  useWordReturn.setState({ entry: null });
}

function begin(input: (ReturnInput & { kind: 'book'; bookKey: string; chapterId: string; tokenId: string }) | (ReturnInput & LessonWordTarget & { kind: 'lesson' })): string {
  discardWordReturn();
  const id = crypto.randomUUID();
  useWordReturn.setState({ entry: { ...input, id, accountId: useAccount.getState().accountId,
    owner: getDataOwnerRevision(), createdAt: Date.now(), phase: 'offer' } });
  return id;
}

export function beginWordReturn(input: ReturnInput & { bookKey: string; chapterId: string; tokenId: string }): string {
  return begin({ ...input, kind: 'book' });
}

export function beginLessonWordReturn(input: ReturnInput & LessonWordTarget): string {
  return begin({ ...input, kind: 'lesson' });
}

export function currentWordReturn(): WordReturn | null {
  const entry = useWordReturn.getState().entry;
  if (!entry || entry.owner !== getDataOwnerRevision() || Date.now() - entry.createdAt > TTL) return null;
  const account = useAccount.getState().accountId;
  return entry.accountId === null || entry.accountId === account ? entry : null;
}

export function readyWordReturn(id: string): boolean {
  const entry = currentWordReturn();
  if (entry?.id !== id) return false;
  forgetStored();
  useWordReturn.setState({ entry: { ...entry, phase: 'ready', accountId: useAccount.getState().accountId } });
  return true;
}

export function prepareWordCheckout(id: string): boolean {
  const entry = currentWordReturn();
  const accountId = useAccount.getState().accountId;
  const pending = readPending();
  if (entry?.id !== id || !accountId || !pending?.invoiceId || (entry.manualDraft?.length ?? 0) > 2000) return false;
  const value: WordReturn = { ...entry, accountId, phase: 'checkout', invoiceId: pending.invoiceId };
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
    useWordReturn.setState({ entry: value });
    return true;
  } catch { return false; }
}

export function restoreWordCheckout(): WordReturn | null {
  const memory = currentWordReturn();
  if (memory) return memory;
  try {
    const parsed = targetSchema.safeParse(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
    if (!parsed.success) return null;
    const e = parsed.data;
    const pending = readPending();
    if (!e.accountId || e.accountId !== useAccount.getState().accountId || e.phase !== 'checkout' || !e.invoiceId
      || pending && pending.invoiceId !== e.invoiceId
      || Date.now() - e.createdAt > TTL || e.createdAt > Date.now()) return null;
    const entry = { ...e, owner: getDataOwnerRevision() };
    useWordReturn.setState({ entry });
    return entry;
  } catch { return null; }
}

export function consumeWordReturn(bookKey: string, chapterId: string, tokenId: string, word: string): WordReturn | null {
  const entry = currentWordReturn();
  if (entry?.phase !== 'ready' || entry.kind !== 'book' || entry.bookKey !== bookKey || entry.chapterId !== chapterId || entry.tokenId !== tokenId || entry.word !== word) return null;
  discardWordReturn();
  return entry;
}

export function consumeLessonWordReturn(target: LessonWordTarget, word: string): WordReturn | null {
  const entry = currentWordReturn();
  if (entry?.kind !== 'lesson' || entry.phase !== 'ready' || lessonWordKey(entry) !== lessonWordKey(target) || entry.word !== word) return null;
  discardWordReturn();
  return entry;
}

subscribeDataScope(change => { if (change === 'reset') discardWordReturn(); });
