import { AppIcon } from '@/shared/ui/AppIcon';
import type { AppIconName } from '@/shared/ui/AppIcon';

export function WelcomeIntro({ ru }: { ru: boolean }) {
  const features: [AppIconName, string, string][] = ru
    ? [
        [
          'today',
          'Учитесь небольшими шагами',
          'Путь от A1 до B2 в вашем темпе.',
        ],
        [
          'library',
          'Читайте с пониманием',
          'Слова и фразы — прямо в контексте книги.',
        ],
        ['vocabulary', 'Запоминайте нужное', 'Свой словарь и повторение слов.'],
      ]
    : [
        [
          'today',
          'Learn in small steps',
          'A path from A1 to B2 at your own pace.',
        ],
        [
          'library',
          'Read with understanding',
          'Words and phrases in the context of your book.',
        ],
        [
          'vocabulary',
          'Remember what you need',
          'Your own vocabulary and spaced practice.',
        ],
      ];
  return (
    <div className="fw-intro-grid">
      <section>
        <p className="fw-lead">
          {ru
            ? 'Не только учите правила. Читайте, замечайте слова и используйте новое каждый день.'
            : 'Go beyond learning rules. Read, notice words and use something new every day.'}
        </p>
        <ul className="fw-features">
          {features.map(([icon, title, body]) => (
            <li key={icon}>
              <AppIcon name={icon} />
              <div>
                <strong>{title}</strong>
                <span>{body}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="fw-art" aria-hidden="true">
        <div className="fw-paper">
          <span className="fw-eyebrow">
            {ru ? 'Маленькая привычка' : 'A small habit'}
          </span>
          <p>
            A <mark>little</mark>
            <br />
            every day.
          </p>
          <small>
            little · {ru ? 'немного' : 'a small amount'}
            <br />
            Small steps make a difference.
          </small>
        </div>
        <span className="fw-saved">
          ✓ {ru ? 'Слово в вашем словаре' : 'A word in your vocabulary'}
        </span>
      </div>
    </div>
  );
}
