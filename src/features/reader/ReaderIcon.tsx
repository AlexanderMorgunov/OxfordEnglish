import icons from '@/assets/reader/reader-icons.svg?raw';
import './reader-icons.css';

const SYMBOLS = new Map(
  [
    ...icons.matchAll(/<symbol id="reader-([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g),
  ].map((match) => [match[1], match[2]])
);
const ALIASES = {
  next: 'skip',
  'chevron-left': 'back',
  'chevron-right': 'arrow',
  'arrow-left': 'back',
  practice: 'cards',
  'chevron-down': 'back',
} as const;
export type ReaderIconName =
  | 'back'
  | 'arrow'
  | 'contents'
  | 'bookmark'
  | 'type'
  | 'grid'
  | 'cards'
  | 'sentence'
  | 'translate'
  | 'play'
  | 'pause'
  | 'stop'
  | 'skip'
  | 'volume'
  | 'close'
  | 'minus'
  | 'plus'
  | 'sparkles'
  | 'select'
  | 'trash'
  | 'check'
  | 'settings'
  | keyof typeof ALIASES;
export function ReaderIcon({
  name,
  className = '',
}: {
  name: ReaderIconName;
  className?: string;
}) {
  const symbol = name in ALIASES ? ALIASES[name as keyof typeof ALIASES] : name;
  // Markup comes only from the checked-in SVG symbols, never from book content.
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`reader-icon${name === 'chevron-down' ? ' reader-icon-down' : ''} ${className}`}
      dangerouslySetInnerHTML={{ __html: SYMBOLS.get(symbol) ?? '' }}
    />
  );
}
