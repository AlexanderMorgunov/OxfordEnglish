import { useEffect, useId, useRef, useState } from 'react';
import { PixelImage } from '@/shared/ui';
import './ProDemo.css';

export type ProDemoKind = 'lesson' | 'reader' | 'text' | 'sync';

export function ProDemo({ kind, ru }: { kind: ProDemoKind; ru: boolean }) {
  const figure = useRef<HTMLElement>(null);
  const id = useId();
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(preference.matches);
    const visibility = () => setPageVisible(!document.hidden);
    preference.addEventListener('change', change);
    document.addEventListener('visibilitychange', visibility);
    return () => { preference.removeEventListener('change', change); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!figure.current) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) setInView(entry.isIntersecting);
    });
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, []);

  const label = kind === 'lesson' ? ru ? 'упражнение' : 'exercise'
    : kind === 'reader' ? ru ? 'читалка' : 'reader'
      : kind === 'text' ? ru ? 'перевод текста' : 'text translation'
        : ru ? 'синхронизация' : 'sync';
  const action = kind === 'lesson' ? ru ? 'почему неверно? (AI)' : 'why is it wrong? (AI)'
    : kind === 'reader' ? ru ? 'грамматика' : 'grammar'
      : ru ? 'Перевести текст' : 'Translate';
  const explanation = kind === 'lesson'
    ? ru ? 'После she к глаголу добавляется -s: She goes to work every day.' : 'Add -s to the verb after she: She goes to work every day.'
    : kind === 'reader'
      ? ru ? 'Be about to + глагол — «вот-вот сделать». She was about to leave — «Она уже собиралась уходить».' : 'Be about to + verb means something is going to happen very soon. She was about to leave = she was just going to leave.'
      : 'Они шли вдоль реки. Берег был усыпан цветами.';
  const source = kind === 'lesson' ? 'She go to work every day.'
    : kind === 'text' ? 'They walked along the river. The bank was covered in flowers.' : 'She was about to leave.';
  const summary = kind === 'sync'
    ? ru ? 'В настройках аккаунта включите синхронизацию файлов книг. На компьютере войдите в тот же аккаунт и продолжайте читать с сохранённого места.' : 'Enable book file sync in account settings. Sign in to the same account on your computer and continue reading at your saved position.'
    : `${source} → ${action} → ${explanation}`;
  const control = paused ? ru ? 'Продолжить анимацию' : 'Resume animation' : ru ? 'Приостановить анимацию' : 'Pause animation';
  const cursor = <svg className="pro-demo-cursor" width="26" height="32" viewBox="0 0 26 32" aria-hidden="true"><path d="M3 2v24l6-6 5 10 5-2-5-10h9Z" fill="currentColor" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" /></svg>;

  return <figure ref={figure} data-demo={kind} data-paused={paused || !inView || !pageVisible}
    className={`pro-demo ${reduced ? '' : 'pro-demo-animated'}`}>
    <figcaption className="pro-demo-caption">
      <span>{ru ? 'Пример' : 'Example'} · {label}</span>
      {!reduced && <button type="button" className="pro-demo-motion" aria-controls={id} aria-label={`${control}: ${label}`} title={control}
        onClick={() => setPaused(value => !value)}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
          {paused ? <path d="M5 3 15 9 5 15Z" /> : <path d="M4 3h3v12H4zM11 3h3v12h-3z" />}
        </svg>
      </button>}
    </figcaption>
    <p className="sr-only">{summary}</p>
    <div id={id} className="pro-demo-scene" aria-hidden="true">
      {kind === 'sync' ? <>
        <div className="pro-demo-devices">
          <div className="pro-demo-device">
            <span>{ru ? 'Телефон · Настройки' : 'Phone · Settings'}</span>
            <p className="pro-demo-book">{ru ? 'Аккаунт и синхронизация' : 'Account and sync'}</p>
            <span className="pro-demo-action"><span className="pro-demo-checkbox"><span>✓</span></span>{ru ? 'Синхронизировать файлы книг' : 'Sync book files'}{cursor}</span>
          </div>
          <div className="pro-demo-device pro-demo-result">
            <span>{ru ? 'На компьютере' : 'On your computer'}</span>
            <p className="pro-demo-book">Alice in Wonderland</p>
            <p>{ru ? 'Глава 3' : 'Chapter 3'} · 42%</p>
            <div className="pro-demo-progress"><span /></div>
            <span className="text-teal">{ru ? 'Продолжить чтение →' : 'Continue reading →'}</span>
          </div>
        </div>
        <p className="pro-demo-footnote">{ru ? 'Войдите в тот же аккаунт на другом устройстве. Прогресс синхронизируется автоматически.' : 'Sign in to the same account on your other device. Progress syncs automatically.'}</p>
      </> : <>
        <p className="pro-demo-sample" lang="en">{kind === 'lesson' ? <>She <span className="pro-demo-wrong">go</span> to work every day.</>
          : kind === 'text' ? <>They walked along the river. The <mark className="pro-demo-term">bank</mark> was covered in flowers.</> : source}
          {kind === 'reader' && <span className="pro-demo-menu-trigger">⋯{cursor}</span>}
        </p>
        {kind === 'text' && <p className="pro-demo-footnote">{ru ? 'Способ перевода: AI' : 'Translation method: AI'}</p>}
        <span className="pro-demo-action">
          {kind === 'reader' ? <span className="text-teal">{ru ? 'гр' : 'gr'}</span> : <PixelImage src={`/assets/pixel/ui/${kind === 'text' ? 'translate' : 'ai'}.png`} alt="" className="h-5 w-5 shrink-0" />}
          {action}{cursor}
        </span>
        <div className="pro-demo-answer pro-demo-result">
          <span className="text-xs text-violet">{kind === 'text' ? ru ? 'Перевод в контексте' : 'Translation in context' : ru ? 'Объяснение AI' : 'AI explanation'}</span>
          <p>{kind === 'text' ? <>Они шли вдоль реки. <mark className="pro-demo-term">Берег</mark> был усыпан цветами.</> : explanation}</p>
        </div>
      </>}
    </div>
  </figure>;
}
