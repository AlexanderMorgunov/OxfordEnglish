import type { ReactNode } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import type { SocialChannel } from './channels';

export function SocialLink({
  channel,
  children,
  className,
  onClick,
}: {
  channel: SocialChannel;
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const ru = useUiLang((state) => state.lang) === 'ru';
  return (
    <a
      href={channel.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={onClick}
    >
      {children ?? (
        <>
          <AppIcon name={channel.id} />
          <span>{ru ? channel.ru : channel.en}</span>
          <AppIcon name="external" className="social-external-icon" />
        </>
      )}
      <span className="sr-only">
        {ru
          ? ' (откроется во внешнем сервисе)'
          : ' (opens an external service)'}
      </span>
    </a>
  );
}
