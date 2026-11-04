import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { AccessFlow } from '@/features/account/AccessFlow';
import { useAccount } from '@/features/account/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { safeAccessReturn } from '@/features/account/access-return';
import { showAccountAccessNotice } from '@/features/account/signupNotice';

export function AccountAccessPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const status = useAccount((s) => s.status);
  const { mode } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const from = params.get('from');
  const destination = safeAccessReturn(from, window.location.origin);
  const initial =
    status === 'authenticated'
      ? 'manage'
      : mode === 'login'
        ? 'login'
        : 'register';
  return (
    <div className="access-layout">
      <aside className="access-story" aria-label="DayEnglish">
        <p>
          {ru
            ? 'Маленькие шаги. Большие перемены.'
            : 'Small steps. Big changes.'}
        </p>
        <h1>
          {ru ? 'Ваш английский.' : 'Your English.'}
          <br />
          <em>{ru ? 'С вами.' : 'With you.'}</em>
        </h1>
        <p>
          {ru
            ? 'Читайте, замечайте новое, возвращайтесь к тому, что важно.'
            : 'Read, discover new things and return to what matters.'}
        </p>
        <div className="access-story-art" aria-hidden="true">
          <svg viewBox="0 0 460 300" fill="none">
            <circle cx="365" cy="61" r="31" fill="var(--color-amber)" />
            <path
              d="M75 216c55-16 108-6 154 12 47-25 101-33 155-12v28c-58-16-108-8-155 13-48-20-99-27-154-13v-28Z"
              fill="var(--color-surface-2)"
              stroke="var(--color-teal)"
              strokeWidth="2"
            />
            <path
              d="M75 108c55-16 108-6 154 12 47-25 101-33 155-12v108c-58-16-108-8-155 13-48-20-99-27-154-13V108Z"
              fill="var(--color-surface)"
              stroke="var(--color-teal)"
              strokeWidth="2"
            />
            <path
              d="M229 120v109M100 141c35-4 66 0 96 10m-96 16c35-4 66 0 96 10m-96 16c35-4 66 0 77 4m86-48c32-12 61-16 95-13m-95 39c32-12 61-16 95-13m-95 39c32-12 48-14 67-13"
              stroke="var(--color-teal)"
              opacity=".45"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path d="M305 98v63l15-10 15 5V94" fill="var(--color-action)" />
            <path
              d="M46 264h363M61 278h91m160 0h70"
              stroke="var(--color-teal)"
              strokeWidth="2"
              opacity=".3"
              strokeLinecap="round"
            />
          </svg>
          <span className="access-word-note">
            <b lang="en">belong</b>
            <small>{ru ? 'быть на своём месте' : 'be where you belong'}</small>
          </span>
        </div>
        <p>
          {ru
            ? 'Один аккаунт для ваших книг, словаря и маленьких побед.'
            : 'One account for your books, vocabulary and small victories.'}
        </p>
      </aside>
      <div>
        <div className="access-page-card">
          <AccessFlow
            key={mode ?? ''}
            initial={initial}
            onContinue={() => navigate(destination)}
            onTrialComplete={(plan) => {
              showAccountAccessNotice(plan);
              navigate(destination);
            }}
          />
        </div>
        <Link to={destination} className="access-text-button">
          {ru ? '← Вернуться к занятиям' : '← Back to learning'}
        </Link>
      </div>
    </div>
  );
}
