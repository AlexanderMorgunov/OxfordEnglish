import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { installDialogMock } from '@/test/dialog';
import { beginWordReturn } from '@/features/reader/word-return';
import { invalidateDataScope } from './dataScope';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import { useProActivation } from './proActivation';
import { ProActivationDialog } from './ProActivationDialog';
import * as api from './api';

vi.mock('./config', () => ({ accountsEnabled: () => true, API_BASE: 'https://fixture.invalid' }));
vi.mock('./AccessFlow', () => ({ AccessFlow: ({ onCancel, onRecoveryDraftChange }: { onCancel: () => void; onRecoveryDraftChange: (value: boolean) => void }) => <div><button onClick={() => onRecoveryDraftChange(true)}>Show new backup codes</button><button onClick={onCancel}>Return to your task</button></div> }));
beforeEach(() => {
  vi.restoreAllMocks(); installDialogMock(); invalidateDataScope();
  useAccount.setState({ status: 'anonymous', accountId: null });
  useEntitlement.setState({ entitlement: { plan: 'free', active: false, ai: { used: 0, limit: 0 } }, loading: false, error: null });
  vi.spyOn(api, 'billingPlans').mockResolvedValue({ available: true, plans: [{ code: 'pro_month', days: 30, title: 'Month', priceKopecks: 19900 }] });
});
test.each(['trial', 'purchase'] as const)('%s inline account cancellation does not discard unacknowledged recovery codes', async intent => {
  const pathname = '/library/book';
  const returnId = beginWordReturn({ pathname, bookKey: 'book', chapterId: 'one', tokenId: '0:0:1', word: 'hoe', manualDraft: null });
  act(() => useProActivation.getState().openReaderWord({ kind: 'reader-word', pathname, task: { source: 'reader', excerpt: 'She used a hoe.' }, word: 'hoe', intent, returnId, trigger: null, fallback: null }));
  render(<MemoryRouter initialEntries={[pathname]}><ProActivationDialog /></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: intent === 'trial' ? 'Start 14 days and translate' : 'Sign in and choose payment' }));
  await user.click(screen.getByRole('button', { name: 'Show new backup codes' }));
  await user.click(screen.getByRole('button', { name: 'Return to your task' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Backup codes have not been saved');
  await user.click(screen.getByRole('button', { name: 'Stay' }));
  expect(screen.getByRole('button', { name: 'Show new backup codes' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Return to your task' }));
  await user.click(screen.getByRole('button', { name: 'Leave without saving' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
