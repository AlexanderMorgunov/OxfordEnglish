import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { loadCatalog } from '@/features/games/api';
import { refreshGameAvailability, useGameAvailability } from '@/features/games/availability';
import { GamePlayer } from '@/features/games/GamePlayer';
import { GameCard, GameDetails } from '@/features/games/GameCatalog';
import { GameSubmission } from '@/features/games/GameSubmission';
import type { GameManifest } from '@/features/games/contract';
import { isLumiAvailable, lumiAnnouncement } from '@/features/announcements/lumi';
import { useCompleteAnnouncementVisit } from '@/features/announcements/model';
import { Button } from '@/shared/ui/Button';
import { AppIcon } from '@/shared/ui/AppIcon';
import '@/features/games/games.css';
import '@/features/games/catalog.css';

const developerGame: GameManifest = {
  gameId: 'integration-demo',
  releaseId: '1.0.0',
  title: 'Game SDK · integration fixture',
  entryUrl: `http://localhost:5188/?host=${encodeURIComponent(location.origin)}`,
  skills: ['grammar.past-vs-continuous'],
  resources: [
    { id: 'intro', access: 'public' },
    { id: 'chapter-2', access: 'pro' },
  ],
};

export function GamesPage() {
  const { gameId } = useParams();
  const { pathname } = useLocation();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { access, epoch } = useGameAvailability();
  const developer = import.meta.env.DEV && gameId === 'integration-demo' &&
    ['localhost', '127.0.0.1'].includes(location.hostname);
  if (developer || access === 'allowed' || access === 'suspended')
    return <GamesContent key={`${pathname}:${epoch}`} developer={developer} suspended={!developer && access === 'suspended'} />;
  if (access === 'loading')
    return <p className="games-status" role="status">{ru ? 'Проверяем доступ…' : 'Checking access…'}</p>;
  return <GameAvailabilityNotice denied={access === 'denied'} sessionChanged={access === 'session-changed'} />;
}

function GameAvailabilityNotice({ denied = false, sessionChanged = false }: { denied?: boolean; sessionChanged?: boolean }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  return (
    <section className="games-status">
      <h1 tabIndex={-1} ref={(node) => { node?.focus({ preventScroll: true }); }}>
        {sessionChanged
          ? (ru ? 'Аккаунт изменился в другой вкладке' : 'The account changed in another tab')
          : denied
          ? (ru ? 'Раздел сейчас недоступен' : 'This section is unavailable')
          : (ru ? 'Не удалось проверить доступ к играм' : 'Could not check access to games')}
      </h1>
      {sessionChanged
        ? <Button onClick={() => location.reload()}>{ru ? 'Обновить страницу' : 'Reload page'}</Button>
        : !denied && <Button onClick={() => void refreshGameAvailability()}>{ru ? 'Повторить' : 'Retry'}</Button>}
      <p><Link to="/">{ru ? 'На главную' : 'Go to the homepage'}</Link></p>
    </section>
  );
}

function GamesContent({ developer, suspended }: { developer: boolean; suspended: boolean }) {
  const { gameId } = useParams();
  const { pathname } = useLocation();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const t = (r: string, e: string) => (ru ? r : e);
  const [catalog, setCatalog] = useState<{
    key: string;
    games: GameManifest[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState('all');
  const submit = pathname === '/games/submit';
  const key = `${developer}:${retry}`;
  const needsCatalog = !suspended && !submit && catalog?.key !== key && error !== key;
  useEffect(() => {
    if (!needsCatalog) return;
    const controller = new AbortController();
    setError(null);
    if (developer) {
      setCatalog({ key, games: [developerGame] });
      return;
    }
    void loadCatalog(controller.signal).then(
      (games) => {
        if (!controller.signal.aborted) setCatalog({ key, games });
      },
      () => {
        if (!controller.signal.aborted) setError(key);
      }
    );
    return () => controller.abort();
  }, [developer, key, needsCatalog]);
  const game = catalog?.key === key ? catalog.games.find((item) => item.gameId === gameId) : undefined;
  const playing = game && !pathname.endsWith('/about');
  const games = catalog?.key === key ? catalog.games : null;
  const fromAnnouncement = useCompleteAnnouncementVisit(
    lumiAnnouncement,
    !developer && !suspended && games?.some(isLumiAvailable) === true
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (fromAnnouncement) heading.current?.focus({ preventScroll: true });
  }, [fromAnnouncement]);
  if (suspended && !playing) return <GameAvailabilityNotice />;
  if (submit) return <GameSubmission />;
  const failed = error === key;
  const categories = [
    ...new Set(
      games?.flatMap((g) =>
        g.presentation?.category ? [g.presentation.category] : []
      ) ?? []
    ),
  ];
  const filtered = games?.filter(
    (g) => filter === 'all' || g.presentation?.category === filter
  );
  const labels: Record<string, string> = {
    all: t('Все темы', 'All topics'),
    grammar: t('Грамматика', 'Grammar'),
    words: t('Лексика', 'Vocabulary'),
    listening: t('Аудирование', 'Listening'),
  };
  return (
    <div className="games-catalog">
      {!gameId && (
        <header className="games-intro">
          <div>
            <p className="games-eyebrow">
              {t('Ещё один способ учиться', 'Another way to learn')}
            </p>
            <h1 ref={heading} tabIndex={-1}>{t('Игры с английским.', 'Play with English.')}</h1>
            <p>
              {t(
                'Разбирайтесь в правилах, исследуя новые миры.',
                'Explore new worlds and discover how English works.'
              )}
            </p>
          </div>
          <span className="games-handwriting" aria-hidden="true">
            play
            <br />& learn.
          </span>
        </header>
      )}
      {gameId && (
        <Link className="games-back" to="/games">
          ← {t('Все игры', 'All games')}
        </Link>
      )}
      {failed ? (
        <section className="games-status" role="alert">
          <h2>
            {t(
              navigator.onLine
                ? 'Каталог пока недоступен'
                : 'Нет подключения к интернету',
              navigator.onLine
                ? 'The catalogue is unavailable'
                : 'You are offline'
            )}
          </h2>
          <p>
            {t(
              'Не удалось загрузить игры. Сохранения на устройстве остаются на месте.',
              'Could not load games. Your local saves remain on this device.'
            )}
          </p>
          <Button onClick={() => setRetry((n) => n + 1)}>
            {t('Повторить', 'Retry')}
          </Button>
        </section>
      ) : !games ? (
        <p className="games-status" role="status">
          {t('Загружаем игры…', 'Loading games…')}
        </p>
      ) : game ? (
        pathname.endsWith('/about') ? (
          <GameDetails game={game} />
        ) : (
          <section className="games-player-section">
            <h1>{game.title}</h1>
            <GamePlayer key={`${game.gameId}:${game.releaseId}`} game={game} rollout={developer ? undefined : suspended ? 'suspended' : 'allowed'} />
          </section>
        )
      ) : gameId ? (
        <section className="games-status">
          <h1>{t('Игра не найдена', 'Game not found')}</h1>
          <p>
            {t(
              'Возможно, она больше недоступна. Ваши сохранения не удалены.',
              'It may no longer be available. Your saves have not been deleted.'
            )}
          </p>
        </section>
      ) : (
        <>
          {games.length > 1 && categories.length > 1 && (
            <div
              className="games-filters"
              aria-label={t('Темы игр', 'Game topics')}
            >
              {['all', ...categories].map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={filter === category}
                  onClick={() => setFilter(category)}
                >
                  {labels[category]}
                </button>
              ))}
            </div>
          )}
          {games.length === 0 ? (
            <section className="games-status">
              <AppIcon name="games" />
              <h2>
                {t(
                  'Первое приключение готовится',
                  'The first adventure is on its way'
                )}
              </h2>
              <p>
                {t(
                  'Здесь появятся игры для практики английского.',
                  'Games to practise English will appear here.'
                )}
              </p>
            </section>
          ) : filtered?.length ? (
            <div className="games-grid">
              {filtered.map((g) => (
                <GameCard key={g.gameId} game={g} />
              ))}
            </div>
          ) : (
            <section className="games-status">
              <h2>
                {t('Пока нет игры на эту тему', 'No games for this topic yet')}
              </h2>
              <Button onClick={() => setFilter('all')}>
                {t('Показать все темы', 'Show all topics')}
              </Button>
            </section>
          )}
        </>
      )}
      {!gameId && (
        <footer className="games-after">
          <div>
            <AppIcon name="games" />
            <h2>
              {t(
                'Новая тема — новый способ играть.',
                'A new topic. A new way to play.'
              )}
            </h2>
            <p>
              {t(
                'Разные миры и механики для практики английского. Продолжение каждой истории — внутри игры.',
                'Different worlds and mechanics to practise English. Continue each story inside its game.'
              )}
            </p>
          </div>
          <div>
            <p className="games-eyebrow">{t('Для авторов', 'For creators')}</p>
            <h2>
              {t(
                'Делаете игру для изучения английского?',
                'Making a game for learning English?'
              )}
            </h2>
            <p>
              {t(
                'Расскажите о ней. Обсудим возможность добавить её в DayEnglish.',
                'Tell us about it. Let’s discuss bringing it to DayEnglish.'
              )}
            </p>
            <Link to="/games/submit" className="games-text-link">
              {t('Предложить свою игру', 'Submit your game')} ↗
            </Link>
          </div>
        </footer>
      )}
    </div>
  );
}
