import { Component, createRef, type ReactNode } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { isPageLoadError, recordPageError, type PageDiagnostic } from '@/shared/lib/page-diagnostics';
import { restartApp } from '@/shared/lib/page-recovery';
import { Button } from './Button';

type Props = { children: ReactNode; resetKey?: string };
type State = { failed: boolean; loadingFailed: boolean; diagnostic: PageDiagnostic | null; restarting: boolean };

/** Scoped fallback: a render throw in a routed page shows this instead of tearing down the whole
 *  app shell. Resets when the route (resetKey) changes so navigating away recovers. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, loadingFailed: false, diagnostic: null, restarting: false };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, loadingFailed: isPageLoadError(error) };
  }

  componentDidCatch(error: unknown) {
    this.setState({ diagnostic: recordPageError(error, this.props.resetKey) });
    this.heading.current?.focus();
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false, loadingFailed: false, diagnostic: null, restarting: false });
    }
  }

  render() {
    if (this.state.failed) {
      const ru = useUiLang.getState().lang === 'ru';
      const loadingFailed = this.state.loadingFailed;
      return (
        <section className="min-w-0 rounded-lg border border-coral/40 bg-surface p-5" aria-label={ru ? 'Ошибка страницы' : 'Page error'}>
          <h1 ref={this.heading} tabIndex={-1} className="font-mono text-sm text-coral">
            {ru ? 'Не удалось открыть страницу' : 'Could not open this page'}
          </h1>
          <p className="mt-2 text-sm text-muted text-pretty">
            {ru
              ? loadingFailed ? 'Не удалось загрузить страницу. Перезапустите приложение, чтобы загрузить её заново.' : 'Попробуйте открыть страницу снова или вернитесь на главную.'
              : loadingFailed ? 'The page could not load. Restart the app to load it again.' : 'Try opening the page again or go back to the dashboard.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {!loadingFailed && <Button className="min-h-11" onClick={() => {
              this.setState({ failed: false, diagnostic: null });
              document.querySelector<HTMLElement>('main')?.focus();
            }}>{ru ? 'Попробовать снова' : 'Try again'}</Button>}
            <Button variant={loadingFailed ? 'primary' : 'ghost'} className="min-h-11" disabled={this.state.restarting} onClick={() => {
              this.setState({ restarting: true }, restartApp);
            }}>{ru ? 'Перезапустить приложение' : 'Restart app'}</Button>
            <a href="/" className="inline-flex min-h-11 items-center rounded-sm px-3 text-sm text-teal hover:underline">{ru ? 'На главную' : 'Go to dashboard'}</a>
          </div>
          <p className="mt-3 text-xs text-muted">{ru ? 'Перезапуск не очищает книги и учебную историю. Несохранённый ввод может пропасть.' : 'Restarting does not clear books or study history. Unsaved input may be lost.'}</p>
          {this.state.diagnostic && <details className="mt-3 min-w-0 text-xs text-muted">
            <summary className="min-h-11 cursor-pointer py-3 text-teal">{ru ? 'Данные об ошибке' : 'Error details'}</summary>
            <p className="mb-2">{ru ? 'Сохранены только технические сведения. Их можно выделить и передать в поддержку.' : 'Only technical details are saved. Select them to share with support.'}</p>
            <textarea readOnly rows={9} aria-label={ru ? 'Диагностика ошибки' : 'Error diagnostics'} value={JSON.stringify(this.state.diagnostic, null, 2)} onFocus={(event) => event.currentTarget.select()} className="block w-full min-w-0 rounded-sm border border-line bg-ink p-2 font-mono text-2xs" />
          </details>}
        </section>
      );
    }
    return this.props.children;
  }
}
