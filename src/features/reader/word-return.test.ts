import { beforeEach, expect, test, vi } from 'vitest';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { beginLessonWordReturn, beginWordReturn, consumeLessonWordReturn, consumeWordReturn, currentWordReturn, prepareWordCheckout, readyWordReturn, restoreWordCheckout, useWordReturn } from './word-return';

const input = { pathname: '/library/book-one', bookKey: 'book-one', chapterId: 'two', tokenId: '0:0:2', word: 'hoe', manualDraft: 'мой перевод' };
beforeEach(() => {
  vi.restoreAllMocks();
  invalidateDataScope();
  localStorage.clear();
  useAccount.setState({ status: 'anonymous', accountId: null });
});
test('anonymous adoption preserves only this word and manual draft, consumed once', () => {
  const id = beginWordReturn(input);
  invalidateDataScope('adopt-anonymous');
  useAccount.setState({ status: 'authenticated', accountId: 'new-owner' });
  expect(readyWordReturn(id)).toBe(true);
  expect(consumeWordReturn('book-one', 'two', '0:0:1', 'hoe')).toBeNull();
  expect(consumeWordReturn('book-one', 'two', '0:0:2', 'garden')).toBeNull();
  expect(consumeWordReturn('book-one', 'two', '0:0:2', 'hoe')).toMatchObject({ manualDraft: 'мой перевод', accountId: 'new-owner' });
  expect(currentWordReturn()).toBeNull();
});
test('logout or existing-account handover discards the draft and any late resume', () => {
  const id = beginWordReturn(input);
  invalidateDataScope();
  useAccount.setState({ accountId: 'other-owner' });
  expect(readyWordReturn(id)).toBe(false);
  expect(currentWordReturn()).toBeNull();
});
test('only checkout persists context, bound to an account without storing sentence or credentials', () => {
  useAccount.setState({ status: 'authenticated', accountId: 'payer' });
  const id = beginWordReturn(input);
  expect(localStorage.getItem('reader.wordReturn')).toBeNull();
  expect(prepareWordCheckout(id)).toBe(false);
  localStorage.setItem('dayenglish.billing.pending', JSON.stringify({ accountId: 'payer', invoiceId: 'fixture-invoice', grantToken: 'fixture-only', startedAt: Date.now() }));
  expect(prepareWordCheckout(id)).toBe(true);
  useWordReturn.setState({ entry: null });
  expect(restoreWordCheckout()).toMatchObject({ phase: 'checkout', invoiceId: 'fixture-invoice', manualDraft: 'мой перевод' });
  expect(consumeWordReturn('book-one', 'two', '0:0:2', 'hoe')).toBeNull();
  expect(readyWordReturn(id)).toBe(true);
  expect(localStorage.getItem('reader.wordReturn')).toBeNull();
  expect(consumeWordReturn('book-one', 'two', '0:0:2', 'hoe')).toBeTruthy();
});
test('another account, expired records and unsafe routes cannot restore a lookup', () => {
  useAccount.setState({ accountId: 'payer' });
  const id = beginWordReturn(input);
  localStorage.setItem('dayenglish.billing.pending', JSON.stringify({ accountId: 'payer', invoiceId: 'fixture-invoice', grantToken: 'fixture-only', startedAt: Date.now() }));
  prepareWordCheckout(id);
  const raw = JSON.parse(localStorage.getItem('reader.wordReturn')!);
  useWordReturn.setState({ entry: null });
  useAccount.setState({ accountId: 'other-owner' });
  expect(restoreWordCheckout()).toBeNull();
  useAccount.setState({ accountId: 'payer' });
  for (const override of [{ pathname: '//example.com' }, { pathname: '/library/book\\escape' }, { tokenId: '0:0:2"]' }, { createdAt: Date.now() - 4 * 86_400_000 }]) {
    localStorage.setItem('reader.wordReturn', JSON.stringify({ ...raw, ...override }));
    expect(restoreWordCheckout()).toBeNull();
  }
});
test('failed context persistence keeps the existing payment journal and manual draft', () => {
  useAccount.setState({ accountId: 'payer' });
  const id = beginWordReturn(input);
  localStorage.setItem('dayenglish.billing.pending', JSON.stringify({ accountId: 'payer', invoiceId: 'fixture-invoice', grantToken: 'fixture-only', startedAt: Date.now() }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage full'); });
  expect(prepareWordCheckout(id)).toBe(false);
  expect(localStorage.getItem('dayenglish.billing.pending')).toContain('fixture-invoice');
  expect(currentWordReturn()?.manualDraft).toBe('мой перевод');
});
test('lesson checkout restores only the validated course/section/block/word target and account', () => {
  useAccount.setState({ accountId: 'payer' });
  const target = { sectionId: 'u01.d02.reading', blockId: 'u01.d02.reading.b2', tokenIndex: 7 };
  const id = beginLessonWordReturn({ ...target, pathname: '/course/u01/day/u01.d02', word: 'short', manualDraft: 'мой перевод' });
  localStorage.setItem('dayenglish.billing.pending', JSON.stringify({ accountId: 'payer', invoiceId: 'lesson-invoice', grantToken: 'fixture-only', startedAt: Date.now() }));
  expect(prepareWordCheckout(id)).toBe(true);
  const raw = JSON.parse(localStorage.getItem('reader.wordReturn')!);
  useWordReturn.setState({ entry: null });
  localStorage.setItem('reader.wordReturn', JSON.stringify({ ...raw, pathname: '/library/other-book' }));
  expect(restoreWordCheckout()).toBeNull();
  localStorage.setItem('reader.wordReturn', JSON.stringify(raw));
  expect(restoreWordCheckout()).toMatchObject({ kind: 'lesson', ...target });
  expect(readyWordReturn(id)).toBe(true);
  expect(consumeLessonWordReturn({ ...target, blockId: 'u01.d02.reading.b1' }, 'short')).toBeNull();
  expect(consumeLessonWordReturn(target, 'short')).toMatchObject({ manualDraft: 'мой перевод' });
});
