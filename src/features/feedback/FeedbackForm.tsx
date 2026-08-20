import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Input, Option } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { collectContext, submitFeedback, type FeedbackCategory, type SubmitResult } from './service';

const CATEGORIES: { id: FeedbackCategory; ru: string; en: string }[] = [
  { id: 'broken', ru: 'Что-то сломалось', en: "Something's broken" },
  { id: 'lesson-error', ru: 'Ошибка в уроке', en: 'A mistake in a lesson' },
  { id: 'idea', ru: 'Есть идея', en: 'I have an idea' },
  { id: 'other', ru: 'Другое', en: 'Something else' },
];

export function FeedbackForm() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const lang = useUiLang((s) => s.lang);
  const level = useLearner((s) => s.level);
  const page = useLocation().pathname;

  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const ctx = collectContext(page, lang, level ?? 'not set');

  const send = async () => {
    if (!category) return;
    setBusy(true);
    const r = await submitFeedback({ category, text, email }, ctx);
    setResult(r);
    setBusy(false);
  };

  if (result) {
    return (
      <div className="rounded-lg border border-teal-dim bg-teal-dim/10 p-5">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.08em] text-teal">
          {result === 'sent'
            ? ru
              ? 'отправлено'
              : 'sent'
            : ru
              ? 'сохранено'
              : 'saved'}
        </p>
        <p className="text-sm leading-relaxed text-pretty">
          {result === 'queued'
            ? ru
              ? 'Нет сети — сообщение сохранено и уйдёт, когда появится интернет. '
              : "You're offline — your message is saved and will send once you're back online. "
            : ''}
          {ru
            ? 'Спасибо! Приложение делает один человек — читаю всё, но ответить успеваю не всегда. Если оставил(а) почту, напишу, когда починю или если нужны детали.'
            : 'Thank you! This app is made by one person — I read everything but can’t always reply. If you left an email, I’ll write back when it’s fixed or if I need details.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" role="group" aria-label={ru ? 'Обратная связь' : 'Feedback'}>
      <div>
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'что случилось?' : "what's up?"}
        </p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Option
              key={c.id}
              state={category === c.id ? 'chosen' : 'default'}
              onClick={() => setCategory(c.id)}
            >
              {ru ? c.ru : c.en}
            </Option>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'подробнее (необязательно)' : 'more detail (optional)'}
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={
            ru
              ? 'напр.: на последнем упражнении не проигрывалось аудио'
              : "e.g. the audio didn't play on the last exercise"
          }
          className="w-full rounded-sm border border-line bg-ink px-3 py-2.5 text-base text-content transition-colors duration-150 placeholder:text-faint focus:border-teal"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'почта — только если хочешь ответ' : 'email — only if you want a reply'}
        </span>
        <Input
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <div>
        <button
          type="button"
          aria-expanded={showContext}
          onClick={() => setShowContext((v) => !v)}
          className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
        >
          {showContext
            ? ru
              ? '▾ что мы отправим'
              : '▾ what we send'
            : ru
              ? '▸ что мы отправим'
              : '▸ what we send'}
        </button>
        {showContext && (
          <div className="mt-2 rounded-sm border border-line bg-surface-2 p-3 font-mono text-2xs text-muted">
            <p className="mb-1.5 text-pretty">
              {ru
                ? 'Только это, и только когда нажмёшь «отправить». Ничего личного, никакой фоновой слежки.'
                : "Only this, and only when you tap send. Nothing personal, no background tracking."}
            </p>
            <ul className="flex flex-col gap-0.5">
              <li>version: {__APP_VERSION__}</li>
              <li>page: {ctx.page}</li>
              <li>level: {ctx.level}</li>
              <li>language: {ctx.lang}</li>
              <li>online: {String(ctx.online)}</li>
              <li className="truncate">browser: {navigator.userAgent}</li>
            </ul>
          </div>
        )}
      </div>

      <div>
        <Button onClick={() => void send()} disabled={!category || busy}>
          {busy ? (ru ? 'Отправляю…' : 'Sending…') : ru ? 'Отправить' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
