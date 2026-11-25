import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { isNativePlatform } from '@/shared/lib/platform';
import { Button } from '@/shared/ui/Button';
import { AppIcon } from '@/shared/ui/AppIcon';
import type { GameManifest } from './contract';
import { useGameSave } from './useGameSave';
import { GameSaves } from './GameSaves';
import { nativeGameSupported } from './nativeRuntime';

export function GameArtwork({ game }: { game: GameManifest }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  return game.presentation?.artwork === 'lumi' ? (
    <div
      className="games-cover games-cover-lumi"
      role="img"
      aria-label={
        ru
          ? 'Долина огней: лес, река и маяк из игры Люми'
          : 'Lumi’s valley with a river and lighthouse'
      }
    >
      <span className="games-cover-caption">
        {ru
          ? 'Маленькая история о том, как понимать друг друга'
          : 'A little story about understanding each other'}
      </span>
      <span className="games-lumi" aria-hidden="true" />
      <span className="games-cover-stamp" aria-hidden="true">
        words light
        <br />
        <em>the way.</em>
      </span>
    </div>
  ) : (
    <div className="games-cover games-cover-fallback" aria-hidden="true">
      <AppIcon name="games" />
      <span>play & learn.</span>
    </div>
  );
}

function GameStart({ game }: { game: GameManifest }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const t = (r: string, e: string) => (ru ? r : e);
  const { state, save } = useGameSave(game.gameId);
  const unavailable = game.presentation?.availability === 'maintenance';
  const native = isNativePlatform();
  return (
    <div className="games-start">
      {save && (
        <p className="games-resume">
          <span aria-hidden="true">●</span>{' '}
          {t(
            'Есть сохранение на этом устройстве',
            'A save is available on this device'
          )}
          <small>
            {save.dirty
              ? t(
                  'Изменения ещё не отправлены в облако',
                  'Changes have not been uploaded'
                )
              : save.cloudRevision > 0
                ? t('Есть облачная копия', 'A cloud copy exists')
                : t('На устройстве', 'On this device')}
          </small>
        </p>
      )}
      {state === 'error' && (
        <p role="alert">
          {t(
            'Не удалось проверить сохранение. Не начинайте заново, если ожидаете продолжить игру.',
            'Could not check saves. Do not start over if you expect to resume.'
          )}
        </p>
      )}
      <p className="games-access">
        {game.resources.some((r) => r.access === 'public')
          ? game.resources.some((r) => r.access === 'pro')
            ? t(
                'Бесплатная часть · отдельный контент по Pro',
                'Free content · additional content with Pro'
              )
            : t('Доступно бесплатно', 'Free to play')
          : t('Контент по Pro', 'Pro content')}
        {game.presentation?.chapters.length
          ? ` · ${t('Глав', 'Chapters')}: ${game.presentation.chapters.length}`
          : ''}
      </p>
      {unavailable ? (
        <p role="status">
          {t(
            'Игра временно недоступна. Сохранения остаются на месте.',
            'Temporarily unavailable. Your saves are kept.'
          )}
        </p>
      ) : native && !nativeGameSupported(game) ? (
        <>
          <p>
            {t(
              'Этот выпуск игры можно открыть на сайте.',
              'This game release is available on the website.'
            )}
          </p>
          <a
            className="games-primary"
            href={`https://dayenglish.ru/games/${encodeURIComponent(game.gameId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('Открыть на сайте', 'Open website')} ↗
          </a>
        </>
      ) : (
        <Link
          className="games-primary"
          to={`/games/${encodeURIComponent(game.gameId)}`}
        >
          {state === 'error' || state === 'loading'
            ? t('Открыть игру', 'Open game')
            : save
              ? t('Продолжить игру', 'Continue game')
              : t('Начать игру', 'Start game')}{' '}
          {!native && <AppIcon name="external" />}
        </Link>
      )}
      <p className="games-compatibility">
        {t(
          'Для загрузки нужен интернет.',
          'Internet is required to load the game.'
        )}
      </p>
    </div>
  );
}

export function GameCard({ game }: { game: GameManifest }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  return (
    <article className="games-feature" aria-labelledby={`game-${game.gameId}`}>
      <div className="games-copy">
        <div className="games-byline">
          {game.presentation?.original && <span>DAYENGLISH ORIGINAL</span>}
          <small>{game.presentation?.subtitle}</small>
        </div>
        <h2 id={`game-${game.gameId}`}>{game.title}</h2>
        <p className="games-description">{game.presentation?.description}</p>
        <div className="games-tags">
          {game.presentation?.topics.map((topic) => (
            <span key={topic}>{topic}</span>
          ))}
        </div>
        <GameStart game={game} />
        <Link
          className="games-text-link"
          to={`/games/${encodeURIComponent(game.gameId)}/about`}
        >
          {ru ? 'Об игре' : 'About the game'} →
        </Link>
      </div>
      <GameArtwork game={game} />
    </article>
  );
}

export function GameDetails({ game }: { game: GameManifest }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const t = (r: string, e: string) => (ru ? r : e);
  const [saves, setSaves] = useState(false);
  const closeSaves = useCallback(() => setSaves(false), []);
  return (
    <article className="games-detail">
      <header>
        <p className="games-eyebrow">
          {game.presentation?.subtitle ??
            t('Практика через игру', 'Learn through play')}
        </p>
        <h1>{game.title}</h1>
        <p>{game.presentation?.description}</p>
      </header>
      <GameArtwork game={game} />
      <div className="games-detail-columns">
        <div>
          {game.presentation?.story && (
            <p className="games-story">{game.presentation.story}</p>
          )}
          {!!game.presentation?.chapters.length && (
            <section className="games-topics">
              <h2>{t('Что будете практиковать', 'What you will practise')}</h2>
              {game.presentation.chapters.map((chapter) => (
                <p key={chapter.title}>
                  <strong>{chapter.title}.</strong> {chapter.description}
                </p>
              ))}
              <p className="games-compatibility">
                {t(
                  'Главы и эпизоды выбираются на карте внутри игры.',
                  'Choose chapters and episodes on the map inside the game.'
                )}
              </p>
            </section>
          )}
        </div>
        <aside>
          <h2>{t('Перед первым шагом', 'Before you begin')}</h2>
          <ul>
            {!!game.presentation?.controls.length && (
              <li>
                {t('Управление: ', 'Controls: ')}
                {game.presentation.controls
                  .map((c) =>
                    c === 'keyboard'
                      ? t('клавиатура', 'keyboard')
                      : t('касания', 'touch')
                  )
                  .join(', ')}
                .
              </li>
            )}
            <li>
              {t(
                'Для запуска нужен интернет. Офлайн-загрузка игр пока недоступна.',
                'Internet is required to launch. Offline game downloads are not available yet.'
              )}
            </li>
            <li>
              {t(
                'Добавление слов в словарь — только с вашим подтверждением.',
                'Words are added to your vocabulary only with your confirmation.'
              )}
            </li>
          </ul>
          <GameStart game={game} />
          <Button variant="ghost" onClick={() => setSaves(true)}>
            {t('Мои сохранения', 'My saves')}
          </Button>
        </aside>
      </div>
      {saves && <GameSaves game={game} onClose={closeSaves} />}
    </article>
  );
}
