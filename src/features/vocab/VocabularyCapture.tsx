import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { cancelAudioInput } from '@/shared/lib/audio-input';
import type { SrsCard } from '@/db/db';
import type { PartOfSpeech } from './grammar-metadata';
import { EnglishDraftSchema, RussianAnswerSchema } from './russian-entry';
import { createVocabularyEntry } from './vocabulary-mutations';
import { DictationInput } from './DictationInput';
import { WordSensesInput } from './WordSensesInput';
import { RussianTermInput } from './RussianTermInput';
import { TermTranslationLookup } from './TermTranslationLookup';
import { VocabularyExample } from './VocabularyExample';
import type { LexiconEntry } from './lexicon';

export function VocabularyCapture({
  open,
  onClose,
  onView,
  onSaved,
  entries,
  lookups,
}: {
  open: boolean;
  onClose: () => void;
  onView: (key: string) => void;
  onSaved: (card: SrsCard, automatic: boolean) => void;
  entries: LexiconEntry[];
  lookups: Record<string, 'loading' | 'unavailable'>;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [newTerm, setNewTerm] = useState(''),
    [newTr, setNewTr] = useState(''),
    [newCtx, setNewCtx] = useState('');
  const [termRevision, setTermRevision] = useState(0);
  const [senseDraft, setSenseDraft] = useState(false),
    [reverseDraft, setReverseDraft] = useState(false);
  const [sensePos, setSensePos] = useState<PartOfSpeech>();
  const [contextAgreed, setContextAgreed] = useState(false);
  const [inputLanguage, setInputLanguage] = useState<'en' | 'ru'>('en');
  const [saving, setSaving] = useState(false),
    [addError, setAddError] = useState('');
  const [saved, setSaved] = useState<SrsCard | null>(null),
    [duplicate, setDuplicate] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<
    'term' | 'translation' | 'context' | null
  >(null);
  const [translationBusy, setTranslationBusy] = useState(false),
    [exampleBusy, setExampleBusy] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const termInput = useRef<HTMLInputElement>(null),
    translationInput = useRef<HTMLInputElement>(null),
    agreementInput = useRef<HTMLInputElement>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null),
    contextPanel = useRef<HTMLDetailsElement>(null);
  const contextInput = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true),
    operation = useRef(0),
    lock = useRef(false);
  const latest = useRef(open);
  latest.current = open;
  const callbacks = useRef({ onClose, onSaved });
  callbacks.current = { onClose, onSaved };
  const translationRequired = senseDraft || reverseDraft;
  const changed = useCallback(() => {
    cancelAudioInput();
    setTermRevision((n) => n + 1);
    setContextAgreed(false);
    setSensePos(undefined);
    setInvalidField(null);
    setAddError('');
    setDuplicate(null);
  }, []);
  const reset = useCallback(() => {
    changed();
    setNewTerm('');
    setNewTr('');
    setNewCtx('');
    setSenseDraft(false);
    setReverseDraft(false);
    setInputLanguage('en');
    setSaved(null);
  }, [changed]);
  const invalidate = useCallback(() => {
    operation.current++;
    lock.current = false;
  }, []);
  const close = () => {
    operation.current++;
    lock.current = false;
    setSaving(false);
    setSaved(null);
    cancelAudioInput();
    setTermRevision((n) => n + 1);
    callbacks.current.onClose();
  };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeDataScope(() => {
      invalidate();
      reset();
      setSaving(false);
      callbacks.current.onClose();
    });
    return () => {
      alive.current = false;
      invalidate();
      cancelAudioInput();
      unsubscribe();
    };
  }, [reset, invalidate]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const target = (saved ? savedHeading : termInput).current;
      const active = document.activeElement;
      if (
        target?.isConnected &&
        (active === document.body || active?.tagName === 'H2')
      )
        target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, saved]);
  const addNew = async () => {
    if (lock.current || translationBusy || exampleBusy) return;
    if (
      !newTerm.trim() ||
      newTerm.trim().length > 160 ||
      !/[a-z]/i.test(newTerm) ||
      /[а-яё\r\n]/i.test(newTerm)
    ) {
      setInvalidField('term');
      setAddError(
        ru
          ? 'Введите слово или короткую фразу на английском — до 160 символов.'
          : 'Enter an English word or short phrase, up to 160 characters.'
      );
      termInput.current?.focus();
      return;
    }
    if (
      reverseDraft &&
      (!EnglishDraftSchema.safeParse(newTerm).success ||
        !RussianAnswerSchema.safeParse(newTr).success)
    ) {
      const termInvalid = !EnglishDraftSchema.safeParse(newTerm).success;
      setInvalidField(termInvalid ? 'term' : 'translation');
      setAddError(
        ru
          ? 'Проверьте английское слово или фразу (до 80 символов) и русский перевод (до 120 символов).'
          : 'Check the English word or phrase (up to 80 characters) and Russian translation (up to 120 characters).'
      );
      (termInvalid ? termInput : translationInput).current?.focus();
      return;
    }
    if (
      translationRequired &&
      (!newTr.trim() || (newCtx.trim() && !contextAgreed))
    ) {
      setInvalidField(!newTr.trim() ? 'translation' : 'context');
      setAddError(
        ru
          ? 'Проверьте перевод и подтвердите, что пример соответствует выбранному значению.'
          : 'Check the translation and confirm that the example matches the chosen meaning.'
      );
      if (!newTr.trim()) translationInput.current?.focus();
      else {
        if (contextPanel.current) contextPanel.current.open = true;
        agreementInput.current?.focus();
      }
      return;
    }
    if (newTr.length > 300 || newCtx.length > 1200) {
      setAddError(
        ru
          ? 'Сократите перевод до 300 символов, а пример — до 1200.'
          : 'Limit the translation to 300 characters and the example to 1200.'
      );
      return;
    }
    const owned = captureDataScope(),
      id = ++operation.current;
    const current = () =>
      alive.current && latest.current && operation.current === id && owned();
    lock.current = true;
    setSaving(true);
    setAddError('');
    setDuplicate(null);
    cancelAudioInput();
    setTermRevision((n) => n + 1);
    try {
      const result = await createVocabularyEntry(
        newTerm,
        newTr,
        newCtx,
        sensePos,
        current
      );
      if (!current()) return;
      if (result.state === 'existing') {
        setDuplicate(result.key);
        return;
      }
      if (result.state === 'deleted') {
        setAddError(
          ru
            ? 'Эта карточка была удалена из повторений. Здесь она не будет создана заново.'
            : 'This card was removed from review. It will not be recreated here.'
        );
        return;
      }
      setSaved(result.card);
      setNewTerm('');
      setNewTr('');
      setNewCtx('');
      setSenseDraft(false);
      setSensePos(undefined);
      setReverseDraft(false);
      setInputLanguage('en');
      setContextAgreed(false);
      callbacks.current.onSaved(result.card, !newTr.trim());
    } catch {
      if (current())
        setAddError(
          ru
            ? 'Не удалось сохранить. Черновик остался на месте. Попробуйте ещё раз.'
            : 'Could not save. Your draft is intact. Please try again.'
        );
    } finally {
      if (operation.current === id) {
        lock.current = false;
        if (alive.current) setSaving(false);
      }
    }
  };
  if (!open) return null;
  const savedEntry =
    saved && entries.find((e) => e.key === saved.front.toLowerCase());
  return (
    <Dialog
      title={ru ? 'Добавить слово или фразу' : 'Add a word or phrase'}
      size="wide"
      onClose={close}
    >
      <div className="vc-capture">
        {saved ? (
          <section className="vc-success">
            <p className="vc-known" role="status">
              {ru
                ? `Сохранено в словаре: «${saved.front}».`
                : `Saved in vocabulary: “${saved.front}”.`}
            </p>
            <h3 ref={savedHeading} tabIndex={-1} lang="en">
              {saved.front}
            </h3>
            <p className="vc-saved-pair">
              {savedEntry?.translation ||
                (ru
                  ? 'Слово сохранено без перевода'
                  : 'Saved without a translation')}
            </p>
            <p>
              {ru
                ? 'Карточка добавлена в повторения. Перевод можно изменить в деталях.'
                : 'A review card has been added. You can edit its translation in the details.'}
            </p>
            {lookups[saved.id] && (
              <p role="status">
                {lookups[saved.id] === 'loading'
                  ? ru
                    ? 'Подбираем перевод отдельно…'
                    : 'Looking up translation…'
                  : ru
                    ? 'Перевод недоступен. Слово уже сохранено; перевод можно добавить позже.'
                    : 'Translation unavailable. Your word is saved; add an answer later.'}
              </p>
            )}
            <div className="vc-actions">
              <Button
                onClick={() => {
                  reset();
                  requestAnimationFrame(() => termInput.current?.focus());
                }}
              >
                {ru ? 'Добавить ещё' : 'Add another'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  close();
                  onView(saved.front.toLowerCase());
                }}
              >
                {ru ? 'Посмотреть слово' : 'View word'}
              </Button>
              <Button variant="ghost" onClick={close}>
                {ru ? 'Готово' : 'Done'}
              </Button>
            </div>
          </section>
        ) : (
          <div className="vc-dialog-layout">
            <form
              className="vc-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void addNew();
              }}
            >
              <details className="vc-more-tools">
                <summary>
                  {ru ? 'Другие способы добавления' : 'More ways to add'}
                </summary>
                <fieldset disabled={saving}>
                  <legend>
                    {ru ? 'Как добавить слово' : 'How to add a term'}
                  </legend>
                  <div className="vc-actions">
                    {(['en', 'ru'] as const).map((language) => (
                      <Button
                        key={language}
                        variant={
                          inputLanguage === language ? 'primary' : 'ghost'
                        }
                        aria-pressed={inputLanguage === language}
                        onClick={() => {
                          if (language === inputLanguage) return;
                          changed();
                          setInputLanguage(language);
                          if (language === 'ru') setReverseDraft(true);
                        }}
                      >
                        {language === 'en'
                          ? ru
                            ? 'На английском'
                            : 'In English'
                          : ru
                            ? 'С русского'
                            : 'From Russian'}
                      </Button>
                    ))}
                  </div>
                </fieldset>
                {inputLanguage === 'ru' && (
                  <RussianTermInput
                    disabled={saving}
                    draftRevision={termRevision}
                    onChoose={(proposal) => {
                      changed();
                      setNewTerm(proposal.english);
                      setNewTr(proposal.russian);
                      requestAnimationFrame(() => termInput.current?.focus());
                    }}
                  />
                )}
                {!saving && (
                  <DictationInput
                    key={termRevision}
                    draft={newTerm}
                    onAccept={(text) => {
                      changed();
                      setNewTerm(text);
                      requestAnimationFrame(() => termInput.current?.focus());
                    }}
                  />
                )}
              </details>
              <label htmlFor="new-term">
                {ru
                  ? 'Слово или фраза на английском'
                  : 'English word or phrase'}
              </label>
              <Input
                id="new-term"
                ref={termInput}
                lang="en"
                autoComplete="off"
                maxLength={160}
                disabled={saving}
                aria-invalid={invalidField === 'term'}
                aria-describedby={
                  invalidField === 'term' ? 'new-term-error' : undefined
                }
                placeholder={
                  ru ? 'Например, journey' : 'word or phrase (English)'
                }
                value={newTerm}
                onChange={(e) => {
                  changed();
                  setNewTerm(e.target.value);
                }}
              />
              <p className="vc-help">
                {ru
                  ? 'Одна карточка — одно слово или целая фраза.'
                  : 'One card holds a word or a whole phrase.'}
              </p>
              <label htmlFor="new-translation">
                {ru ? 'Перевод' : 'Translation'}
              </label>
              <TermTranslationLookup
                term={newTerm}
                draftRevision={termRevision}
                disabled={saving || exampleBusy}
                onBusyChange={setTranslationBusy}
                onApply={(translation) => {
                  changed();
                  setNewTr(translation);
                  requestAnimationFrame(() =>
                    translationInput.current?.focus()
                  );
                }}
              />
              <Input
                id="new-translation"
                ref={translationInput}
                lang="ru"
                disabled={saving}
                maxLength={300}
                aria-required={translationRequired}
                aria-invalid={invalidField === 'translation'}
                aria-describedby={`new-translation-help${invalidField === 'translation' ? ' new-term-error' : ''}`}
                placeholder={
                  translationRequired
                    ? ru
                      ? 'Русский перевод (обязательно)'
                      : 'Russian translation (required)'
                    : ru
                      ? 'Ваше значение'
                      : 'translation (optional)'
                }
                value={newTr}
                onChange={(e) => {
                  changed();
                  setNewTr(e.target.value);
                }}
              />
              <p id="new-translation-help" className="vc-help">
                {translationRequired
                  ? ru
                    ? 'Проверьте, что перевод соответствует нужному значению.'
                    : 'Check that the Russian translation matches the intended meaning.'
                  : ru
                    ? 'Можно перевести сейчас, написать свой вариант или сохранить без перевода.'
                    : 'Translate now, write your own answer or save without a translation.'}
              </p>
              <details
                ref={contextPanel}
                className="vc-context"
                open={!!newCtx || translationRequired || undefined}
                onToggle={(e) => setContextOpen(e.currentTarget.open)}
              >
                <summary>{ru ? 'Добавить пример' : 'Add example'}</summary>
                <label htmlFor="new-context">
                  {ru ? 'Пример или контекст' : 'Example or context'}
                </label>
                <textarea
                  id="new-context"
                  ref={contextInput}
                  lang="en"
                  className="vc-input"
                  maxLength={1200}
                  disabled={saving}
                  value={newCtx}
                  onChange={(e) => {
                    changed();
                    setNewCtx(e.target.value);
                  }}
                />
                <VocabularyExample
                  term={newTerm}
                  revision={termRevision}
                  disabled={saving || translationBusy || !contextOpen}
                  onBusyChange={setExampleBusy}
                  onApply={(sense) => {
                    changed();
                    setNewCtx(sense.example);
                    if (!newTr.trim()) setNewTr(sense.translation);
                    setSenseDraft(true);
                    setSensePos(sense.partOfSpeech);
                    setContextAgreed(true);
                    if (contextPanel.current) contextPanel.current.open = true;
                    requestAnimationFrame(() => contextInput.current?.focus());
                  }}
                />
                {translationRequired && newCtx.trim() && (
                  <label className="vc-agreement">
                    <input
                      ref={agreementInput}
                      type="checkbox"
                      disabled={saving}
                      checked={contextAgreed}
                      aria-invalid={invalidField === 'context'}
                      aria-describedby={
                        invalidField === 'context'
                          ? 'new-term-error'
                          : undefined
                      }
                      onChange={(e) => {
                        setContextAgreed(e.target.checked);
                        setAddError('');
                        setInvalidField(null);
                      }}
                    />
                    {ru
                      ? 'Мой пример соответствует выбранному значению'
                      : 'My example matches the chosen meaning'}
                  </label>
                )}
              </details>
              <WordSensesInput
                key={`${inputLanguage}:${newTerm}`}
                term={newTerm}
                context={newCtx}
                draftRevision={termRevision}
                disabled={saving || translationBusy || exampleBusy}
                onChoose={(sense, useExample) => {
                  changed();
                  setNewTr(sense.translation);
                  if (useExample) setNewCtx(sense.example);
                  setSensePos(sense.partOfSpeech);
                  setSenseDraft(true);
                  setContextAgreed(true);
                  requestAnimationFrame(() =>
                    translationInput.current?.focus()
                  );
                }}
              />
              {addError && (
                <p id="new-term-error" role="alert" className="vc-error">
                  {addError}
                </p>
              )}
              {duplicate && (
                <div className="vc-duplicate" role="status">
                  <p>
                    {ru
                      ? 'Это слово уже есть в словаре. Перевод и расписание повторений сохранены.'
                      : 'This term is already in your vocabulary. Its answer and review schedule are unchanged.'}
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      close();
                      onView(duplicate);
                    }}
                  >
                    {ru ? 'Открыть существующее слово' : 'Open existing word'}
                  </Button>
                </div>
              )}
              <div className="vc-actions">
                <Button
                  type="submit"
                  disabled={saving || translationBusy || exampleBusy}
                >
                  {saving
                    ? ru
                      ? 'Сохраняем…'
                      : 'Saving…'
                    : ru
                      ? 'Сохранить в словарь'
                      : 'Save in vocabulary'}
                </Button>
                <Button variant="ghost" onClick={close}>
                  {ru ? 'Отмена' : 'Cancel'}
                </Button>
              </div>
              {(reverseDraft || senseDraft) && (
                <Button variant="ghost" disabled={saving} onClick={reset}>
                  {ru ? 'Очистить черновик' : 'Start over'}
                </Button>
              )}
            </form>
            <aside
              className="vc-dialog-preview"
              aria-label={ru ? 'Предпросмотр карточки' : 'Card preview'}
            >
              <p className="vc-preview-label">
                {ru ? 'Как будет выглядеть карточка' : 'Your card preview'}
              </p>
              <h3 lang="en">
                {newTerm.trim() || (ru ? 'Ваше новое слово' : 'Your new word')}
              </h3>
              <p className="vc-preview-meaning">
                {newTr.trim() ||
                  (ru
                    ? 'Перевод можно добавить позже'
                    : 'Add a translation later')}
              </p>
              {newCtx.trim() && (
                <blockquote lang="en" className="vc-example">
                  {newCtx.trim()}
                </blockquote>
              )}
              <p className="vc-preview-note">
                {ru
                  ? 'Сейчас это черновик. После сохранения слово появится в словаре и в повторениях.'
                  : 'This is a draft. Saving adds the term to your vocabulary and review.'}
              </p>
            </aside>
          </div>
        )}
      </div>
    </Dialog>
  );
}
