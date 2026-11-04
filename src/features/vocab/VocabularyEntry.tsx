import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { captureDataScope } from '@/features/account/dataScope';
import type { LexiconEntry } from './lexicon';
import { setTranslation } from './manage';
import {
  addVocabularyCard,
  changeVocabularyStatus,
  removeVocabularyCard,
} from './vocabulary-mutations';
import { TermTranslationLookup } from './TermTranslationLookup';
import { useLemma, baseForm } from './lemma';
import { irregularForms } from './irregular';
import { useCefr, cefrOf } from './cefr';
import { FormsLine } from './FormsLine';
import { ContextSentence } from './ContextSentence';
import { VocabularyRating } from './VocabularyRating';
import { VocabularySpeak } from './VocabularySpeech';
import type { useVocabularySpeech } from './useVocabularySpeech';

export function VocabularyEntry({
  entry,
  deleted,
  onBack,
  speech,
  lookup,
}: {
  entry: LexiconEntry | null;
  deleted: boolean;
  onBack: (notice?: string) => void;
  speech: ReturnType<typeof useVocabularySpeech>;
  lookup?: 'loading' | 'unavailable';
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const lemma = useLemma(),
    cefr = useCefr();
  const [editing, setEditing] = useState<LexiconEntry | null>(null),
    [draft, setDraft] = useState('');
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    editButton = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLButtonElement>(null),
    removeButton = useRef<HTMLButtonElement>(null);
  const operation = useRef(0),
    lock = useRef(false),
    mounted = useRef(true);
  const last = useRef(entry);
  if (entry) last.current = entry;
  const item = entry ?? (busy === 'remove' ? last.current : null);
  const invalidate = useCallback(() => {
    operation.current++;
    lock.current = false;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [invalidate]);
  useEffect(() => {
    if (
      !document.activeElement?.closest(
        '.app-header,.app-nav-bottom,dialog[open]'
      )
    )
      heading.current?.focus({ preventScroll: true });
  }, [entry?.key]);
  const perform = async (
    name: string,
    action: (current: () => boolean) => Promise<void>,
    complete?: () => void
  ) => {
    if (lock.current) return;
    const data = captureDataScope(),
      id = ++operation.current;
    const current = () => mounted.current && id === operation.current && data();
    lock.current = true;
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await action(current);
      if (current()) complete?.();
    } catch {
      if (current())
        setError(
          ru
            ? 'Не удалось сохранить изменение. Запись могла измениться; проверьте её и повторите.'
            : 'Could not save the change. The entry may have changed; check it and retry.'
        );
    } finally {
      if (operation.current === id) {
        lock.current = false;
        if (mounted.current) setBusy(null);
      }
    }
  };
  const cancelEdit = () => {
    operation.current++;
    lock.current = false;
    setBusy(null);
    setEditing(null);
    setError('');
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const forms =
      item?.kind === 'word' ? irregularForms(item.display, lemma) : [],
    base =
      item?.kind === 'word' && !forms.length
        ? baseForm(item.display, lemma)
        : null;
  if (!item)
    return (
      <div className="vc-empty">
        <h1>
          {ru
            ? 'Слово больше не в словаре'
            : 'This word is no longer in your vocabulary'}
        </h1>
        <p>
          {ru
            ? 'Карточка могла быть удалена на другом устройстве. Поиск и фильтры сохранены.'
            : 'Its card may have been removed on another device. Your search and filters are preserved.'}
        </p>
        <Button variant="ghost" onClick={() => onBack()}>
          {ru ? 'К моему словарю' : 'Back to vocabulary'}
        </Button>
      </div>
    );
  const due =
    item.due !== undefined && Number.isFinite(item.due)
      ? new Date(item.due).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : null;
  return (
    <article className="vc-detail">
      <button className="vc-text-button vc-back" onClick={() => onBack()}>
        {ru ? '← Мой словарь' : '← My vocabulary'}
      </button>
      <div className="vc-detail-top">
        <div>
          <h1 ref={heading} tabIndex={-1} lang="en">
            {item.display}
          </h1>
          <div className="vc-metadata">
            <VocabularyRating
              hit={
                item.kind === 'word' ? cefrOf(item.display, cefr, lemma) : null
              }
            />
            {item.kind === 'phrase' && (
              <span className="vc-tag">{ru ? 'Фраза' : 'Phrase'}</span>
            )}
            {base && (
              <span>
                {ru ? 'Базовая форма:' : 'Base form:'} {base}
              </span>
            )}
          </div>
        </div>
        <div>
          <p className="vc-meaning" lang="ru">
            {item.translation ||
              (ru ? 'Перевод пока не добавлен' : 'No translation yet')}
          </p>
          <div className="vc-actions">
            <Button
              ref={editButton}
              variant="ghost"
              aria-expanded={!!editing}
              disabled={!!busy}
              onClick={() => {
                if (editing) {
                  input.current?.focus();
                  return;
                }
                setDraft(item.translation ?? '');
                setEditing(item);
                setRevision((n) => n + 1);
                setError('');
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              {ru ? 'Изменить перевод' : 'Edit translation'}
            </Button>
            <VocabularySpeak term={item.display} speech={speech} />
          </div>
        </div>
      </div>
      {!item.translation && (
        <p className="vc-notice" role="status">
          {lookup === 'loading'
            ? ru
              ? 'Слово сохранено. Подбираем перевод отдельно…'
              : 'Word saved. Looking up translation…'
            : ru
              ? 'Слово сохранено без перевода. Откройте «Изменить перевод», чтобы написать свой вариант или найти перевод.'
              : 'Saved without a translation. Open Edit translation to type an answer or look it up.'}
        </p>
      )}
      {editing && (
        <form
          className="vc-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const expected = editing;
            void perform(
              'save',
              async (current) => {
                if (!(await setTranslation(expected, draft, current)))
                  throw new Error('Changed entry');
              },
              () => {
                setEditing(null);
                setNotice(ru ? 'Перевод сохранён.' : 'Translation saved.');
                requestAnimationFrame(() => editButton.current?.focus());
              }
            );
          }}
        >
          <label htmlFor="vc-edit-input">
            {ru ? 'Перевод' : 'Translation'}
          </label>
          <Input
            id="vc-edit-input"
            ref={input}
            lang="ru"
            value={draft}
            disabled={!!busy}
            maxLength={300}
            onChange={(e) => {
              setDraft(e.target.value);
              setRevision((n) => n + 1);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
          />
          <TermTranslationLookup
            term={item.display}
            draftRevision={revision}
            disabled={!!busy}
            onApply={(value) => {
              setDraft(value);
              setRevision((n) => n + 1);
            }}
          />
          <div className="vc-actions">
            <Button type="submit" disabled={!!busy}>
              {busy === 'save'
                ? ru
                  ? 'Сохраняем…'
                  : 'Saving…'
                : ru
                  ? 'Сохранить перевод'
                  : 'Save translation'}
            </Button>
            <Button variant="ghost" onClick={cancelEdit}>
              {ru ? 'Отмена' : 'Cancel edit'}
            </Button>
          </div>
        </form>
      )}
      <div className="vc-detail-grid">
        <section className="vc-detail-section">
          <h2>{ru ? 'В контексте' : 'In context'}</h2>
          {item.context ? (
            <>
              <ContextSentence
                text={item.context}
                term={item.display}
                isPhrase={item.kind === 'phrase'}
                data={lemma}
                className="vc-example"
              />
            </>
          ) : (
            <p>{ru ? 'Пример пока не добавлен.' : 'No example yet.'}</p>
          )}
          {item.contextGloss && (
            <p className="vc-gloss">
              <strong>
                {ru ? 'Значение в примере:' : 'Meaning in this example:'}
              </strong>{' '}
              {item.contextGloss}
            </p>
          )}
          <FormsLine word={item.display} forms={forms} />
          <p className="vc-help">
            {ru
              ? 'Уровень рядом со словом — справочный ориентир, а не оценка ваших знаний.'
              : 'The level is a reference guide, not an assessment of your knowledge.'}
          </p>
        </section>
        <section className="vc-detail-section">
          <h2>
            <label htmlFor="vc-status">
              {ru ? 'Моя отметка' : 'My status'}
            </label>
          </h2>
          <select
            id="vc-status"
            className="vc-select vc-status-control"
            value={item.status ?? ''}
            disabled={!!busy || !!editing}
            onChange={(e) => {
              const next = e.target.value as 'learning' | 'known' | 'ignored';
              void perform(
                'status',
                (current) => changeVocabularyStatus(item, next, current),
                () => setNotice(ru ? 'Отметка сохранена.' : 'Status saved.')
              );
            }}
          >
            <option value="" disabled>
              {ru ? 'Без отметки' : 'No status'}
            </option>
            <option value="learning">{ru ? 'Учу' : 'Learning'}</option>
            <option value="known">{ru ? 'Знаю' : 'Known'}</option>
            <option value="ignored">{ru ? 'Скрыть' : 'Hide'}</option>
          </select>
          <p>
            {ru
              ? 'Отметка и карточка для повторения — разные вещи. «Знаю» не выключает повторения.'
              : 'Your status and review card are separate. Known keeps the review card.'}
          </p>
          <h2>{ru ? 'Повторения' : 'Review'}</h2>
          <p>
            {item.hasCard
              ? item.status === 'ignored'
                ? ru
                  ? 'Карточка сохранена, но скрытое слово не попадает в очередь повторений.'
                  : 'The card is saved, but hidden words are excluded from review.'
                : due
                  ? ru
                    ? `Следующее повторение: ${due}.`
                    : `Next review: ${due}.`
                  : ru
                    ? 'Карточка сохранена для повторений.'
                    : 'A review card is saved.'
              : ru
                ? 'Карточки для повторения пока нет.'
                : 'No review card yet.'}
          </p>
          {item.hasCard ? (
            <Button
              ref={removeButton}
              variant="ghost"
              disabled={!!busy || !!editing}
              onClick={() => {
                setConfirm(true);
                requestAnimationFrame(() => confirmation.current?.focus());
              }}
            >
              {ru ? 'Убрать из повторений' : 'Remove from review'}
            </Button>
          ) : deleted ? (
            <p className="vc-help">
              {ru
                ? 'Эта карточка была удалена. Она не восстанавливается автоматически.'
                : 'This card was removed. It is not restored automatically.'}
            </p>
          ) : (
            <Button
              variant="ghost"
              disabled={!!busy || !!editing}
              onClick={() =>
                void perform(
                  'add',
                  (current) => addVocabularyCard(item, current),
                  () =>
                    setNotice(
                      ru
                        ? 'Карточка добавлена в повторения.'
                        : 'Review card added.'
                    )
                )
              }
            >
              {ru ? 'Добавить в повторения' : 'Add to review'}
            </Button>
          )}
          {confirm && (
            <div
              className="vc-inline-confirm"
              role="group"
              aria-label={ru ? 'Удаление карточки' : 'Remove review card'}
            >
              <p>
                {item.status
                  ? ru
                    ? 'Слово и ваша отметка останутся в словаре. Карточка исчезнет из повторений.'
                    : 'The word and its status stay in your vocabulary. The card leaves review.'
                  : ru
                    ? 'У слова нет отдельной отметки. Оно исчезнет и из списка словаря.'
                    : 'This word has no separate status. It will also leave the vocabulary list.'}
              </p>
              <div className="vc-actions">
                <Button
                  ref={confirmation}
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    void perform(
                      'remove',
                      (current) => removeVocabularyCard(item, current),
                      () => {
                        setConfirm(false);
                        if (!item.status)
                          onBack(
                            ru
                              ? 'Карточка убрана из повторений.'
                              : 'Card removed from review.'
                          );
                        else {
                          setNotice(
                            ru
                              ? 'Карточка убрана. Ваша отметка сохранена.'
                              : 'Card removed. Your status is preserved.'
                          );
                          requestAnimationFrame(() => heading.current?.focus());
                        }
                      }
                    )
                  }
                >
                  {ru ? 'Убрать карточку' : 'Remove card'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => {
                    setConfirm(false);
                    removeButton.current?.focus();
                  }}
                >
                  {ru ? 'Оставить' : 'Keep card'}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      {error && (
        <p role="alert" className="vc-error">
          {error}
        </p>
      )}
      <p className="vc-detail-status" role="status" aria-atomic="true">
        {notice}
      </p>
    </article>
  );
}
