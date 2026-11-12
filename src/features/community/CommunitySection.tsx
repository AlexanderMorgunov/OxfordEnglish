import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import { SOCIAL_CHANNELS } from './channels';
import type { SocialChannel } from './channels';
import { SocialLink } from './SocialLink';
import './community.css';

function ChannelCard({ channel }: { channel: SocialChannel }) {
  const ru = useUiLang((state) => state.lang) === 'ru';
  const [copy, setCopy] = useState<'idle' | 'pending' | 'copied' | 'manual'>(
    'idle'
  );
  const generation = useRef(0),
    locked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const invalidate = useCallback(() => {
    generation.current++;
    locked.current = false;
  }, []);
  useEffect(() => {
    const reset = () => {
      invalidate();
      setCopy((state) => (state === 'pending' ? 'idle' : state));
    };
    window.addEventListener('pagehide', reset);
    return () => {
      invalidate();
      window.removeEventListener('pagehide', reset);
    };
  }, [invalidate]);
  useEffect(() => {
    if (copy === 'manual') {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
  }, [copy]);
  const copyUrl = async () => {
    if (locked.current) return;
    locked.current = true;
    const ticket = ++generation.current;
    setCopy('pending');
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(channel.url);
      if (generation.current === ticket) setCopy('copied');
    } catch {
      if (generation.current === ticket) setCopy('manual');
    } finally {
      if (generation.current === ticket) locked.current = false;
    }
  };
  const name = ru ? channel.ru : channel.en;
  return (
    <article className="community-channel" aria-labelledby={id + '-title'}>
      <div className="community-channel-heading">
        <span className="community-channel-icon">
          <AppIcon name={channel.id} />
        </span>
        <div>
          <h3 id={id + '-title'}>{name}</h3>
          <p>{ru ? channel.accountRu : channel.accountEn}</p>
        </div>
        <span className="community-official">
          {ru ? channel.officialRu : 'Official'}
        </span>
      </div>
      <p className="community-description">
        {ru ? channel.descriptionRu : channel.descriptionEn}
      </p>
      <SocialLink channel={channel} className="community-address">
        {channel.url.replace('https://', '')}
      </SocialLink>
      <div className="community-actions">
        <SocialLink channel={channel} className="community-open">
          <span>{ru ? `Открыть ${name}` : `Open ${name}`}</span>
          <AppIcon name="external" />
        </SocialLink>
        <button
          type="button"
          className="community-copy"
          onClick={() => void copyUrl()}
          disabled={copy === 'pending'}
          aria-busy={copy === 'pending' || undefined}
          aria-label={
            ru ? `Скопировать ссылку на ${name}` : `Copy ${name} link`
          }
          aria-describedby={id + '-status'}
          title={ru ? 'Копировать ссылку' : 'Copy link'}
        >
          <AppIcon name="copy" />
          <span>{ru ? 'Копировать ссылку' : 'Copy link'}</span>
        </button>
      </div>
      <p id={id + '-status'} className="community-copy-status" role="status">
        {copy === 'pending'
          ? ru
            ? 'Копируем ссылку…'
            : 'Copying link…'
          : copy === 'copied'
            ? ru
              ? 'Ссылка скопирована'
              : 'Link copied'
            : copy === 'manual'
              ? ru
                ? 'Не удалось скопировать автоматически'
                : 'Could not copy automatically'
              : ''}
      </p>
      {copy === 'manual' && (
        <div className="community-copy-fallback">
          <label htmlFor={id + '-url'}>
            {ru ? 'Скопируйте адрес вручную' : 'Copy the address manually'}
          </label>
          <input
            ref={input}
            id={id + '-url'}
            readOnly
            value={channel.url}
            spellCheck={false}
            onClick={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            onClick={() => {
              input.current?.focus();
              input.current?.select();
            }}
          >
            {ru ? 'Выделить ссылку' : 'Select link'}
          </button>
        </div>
      )}
    </article>
  );
}

export function CommunitySection() {
  const ru = useUiLang((state) => state.lang) === 'ru';
  return (
    <section
      id="community"
      className="community-section"
      tabIndex={-1}
      aria-labelledby="community-title"
    >
      <div className="community-heading">
        <p className="community-eyebrow">
          {ru ? 'Ещё немного английского' : 'A little more English'}
        </p>
        <h2 id="community-title">
          {ru ? 'DayEnglish в соцсетях' : 'DayEnglish on social media'}
        </h2>
        <p>
          {ru
            ? 'Полезные фразы, короткие задания и новости проекта. Выбирайте, где вам удобнее нас читать.'
            : 'Useful phrases, short activities and project news. Choose where you prefer to follow us.'}
        </p>
      </div>
      <div className="community-channels">
        {SOCIAL_CHANNELS.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} />
        ))}
      </div>
      <p className="community-external-note">
        {ru
          ? 'Откроется внешний сервис. Подписаться можно уже на его странице.'
          : 'An external service will open. You can subscribe on its page.'}
      </p>
    </section>
  );
}
