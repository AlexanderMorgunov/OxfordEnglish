import type { Announcement } from './model';
import type { GameManifest } from '@/features/games/contract';
import { nativeGameSupported } from '@/features/games/nativeRuntime';
import { isNativePlatform } from '@/shared/lib/platform';
import artwork from '@/assets/games/lumi-valley.png';

export const lumiAnnouncement: Announcement = {
  id: 'lumi-games-launch',
  placement: 'today',
  title: {
    ru: 'Первая игра — «Люми и дорога огней»',
    en: 'Our first game · Lumi and the Road of Lights',
  },
  description: {
    ru: 'Собирайте фразы на английском и помогайте жителям долины. Уже доступны две главы.',
    en: 'Build English phrases to help the people of the valley. Two chapters are ready to play.',
  },
  action: { ru: 'Открыть каталог игр', en: 'Open the games catalogue' },
  to: '/games',
  artwork,
};

export function isLumiAvailable(game: GameManifest): boolean {
  return (
    game.gameId === 'lumi-road-of-lights' &&
    game.presentation?.availability !== 'maintenance' &&
    (!isNativePlatform() || nativeGameSupported(game))
  );
}
