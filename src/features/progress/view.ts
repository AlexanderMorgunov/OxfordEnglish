import { create } from 'zustand';
import { subscribeDataScope } from '@/features/account/dataScope';
import type { Period } from '@/features/stats/accounting';

type ProgressView = {
  period: Period;
  filter: string;
  expanded: boolean;
  bar: string;
  anchor: { id: string; top: number } | null;
};
const initial: ProgressView = {
  period: 'week',
  filter: 'all',
  expanded: false,
  bar: '',
  anchor: null,
};
export const useProgressView = create<
  ProgressView & { update: (next: Partial<ProgressView>) => void }
>((set) => ({
  ...initial,
  update: (next) => set(next),
}));
subscribeDataScope(() => useProgressView.setState(initial));

export function rememberProgress(id: string) {
  const element = document.getElementById(id);
  if (element)
    useProgressView.setState({
      anchor: { id, top: element.getBoundingClientRect().top },
    });
}
