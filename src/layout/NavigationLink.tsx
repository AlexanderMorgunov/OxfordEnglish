import { Link } from 'react-router-dom';
import { AppIcon } from '@/shared/ui/AppIcon';
import type { NavDestination } from './navigation';

export function NavigationLink({
  item,
  ru,
  current,
  onClick,
}: {
  item: NavDestination;
  ru: boolean;
  current: string | null;
  onClick?: () => void;
}) {
  return (
    <Link
      to={item.to}
      data-nav-destination={item.to}
      data-tour={item.tour}
      aria-current={current === item.to ? 'page' : undefined}
      onClick={onClick}
    >
      <AppIcon name={item.icon} />
      <span>{ru ? item.ru : item.en}</span>
    </Link>
  );
}
