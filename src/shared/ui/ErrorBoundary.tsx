import { Component, type ReactNode } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';

type Props = { children: ReactNode; resetKey?: string };
type State = { error: Error | null };

/** Scoped fallback: a render throw in a routed page shows this instead of tearing down the whole
 *  app shell. Resets when the route (resetKey) changes so navigating away recovers. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      const ru = useUiLang.getState().lang === 'ru';
      return (
        <div className="rounded-lg border border-coral/40 bg-surface p-5">
          <p className="font-mono text-sm text-coral">
            {ru ? '✕ на этой странице что-то пошло не так' : '✕ something went wrong on this page'}
          </p>
          <p className="mt-2 text-sm text-muted text-pretty">
            {ru
              ? 'Попробуйте обновить страницу или вернуться на главную. Остальное приложение работает.'
              : 'Try reloading or going back to the dashboard. The rest of the app still works.'}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
