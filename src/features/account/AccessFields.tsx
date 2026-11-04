import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Input } from '@/shared/ui';

export function AccessIcon({
  name,
}: {
  name: 'eye' | 'key' | 'shield' | 'check' | 'arrow' | 'copy' | 'download';
}) {
  const paths = {
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="8" r="5" />
        <path d="m12 12 9 9m-5-5 3-3m-6 0 3-3" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function AccessField({
  label,
  hint,
  error,
  password = false,
  ru,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  password?: boolean;
  ru: boolean;
}) {
  const generated = useId(),
    id = props.id ?? generated;
  const [visible, setVisible] = useState(false);
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="access-field">
      <label htmlFor={id}>{label}</label>
      <div className={password ? 'access-password' : undefined}>
        <Input
          {...props}
          id={id}
          type={
            password ? (visible ? 'text' : 'password') : (props.type ?? 'text')
          }
          aria-invalid={!!error}
          aria-describedby={described || undefined}
        />
        {password && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={
              visible
                ? ru
                  ? 'Скрыть пароль'
                  : 'Hide password'
                : ru
                  ? 'Показать пароль'
                  : 'Show password'
            }
            aria-pressed={visible}
          >
            <AccessIcon name="eye" />
          </button>
        )}
      </div>
      {hint && (
        <p className="access-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="access-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
