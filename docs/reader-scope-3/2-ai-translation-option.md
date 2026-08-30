# Plan #2 — AI translation for sentences & phrases (keep free), chosen in settings

## Goal (user)
Let sentence and phrase translations use the AI (better quality); keep the free (no-key) translation too;
expose the choice in settings.

## Research / analysis (code)
- **Free path today:** `src/features/vocab/translate.ts › translateText(text)` — MyMemory (free, no key),
  cached in IndexedDB (`db.translations`, `source:'mymemory'`), chunked to the 480-char limit, returns
  `null` on failure. Used by the per-sentence "ru" toggle (`Paragraph.toggleSentence` →
  `translateText(sentence)`) and the phrase popover (`ReadingText.setPhraseText` → `translateText`).
- **AI layer:** `src/features/ai/functions.ts › ask(config, system, user, cacheKey)` wraps
  `provider.complete` with a localStorage cache; `wordInContext` is the model for a short EN→RU task.
  `ai/store › isConfigured(config)` says whether a key/model is set; `useAiStore(s => s.config)` supplies it.
- **Reader settings:** `src/features/reader/settings.ts` — hand-rolled localStorage persist (add a field
  by enumerating it in `Persisted`/`DEFAULTS`/`persist`).

## Design
1. **AI translate fn.** In `ai/functions.ts` add `translateText(config, text): Promise<string>` (name it
   `aiTranslate` to avoid colliding with vocab's `translateText`): system = a translator persona ("Переводи
   на русский точно и естественно; верни ТОЛЬКО перевод, без пояснений"), user = the text; cache via `ask`
   keyed by the text. Works for a sentence OR a phrase (both are short). Trim/strip any accidental quoting.
2. **Setting.** Add `translation: 'free' | 'ai'` to reader settings (default `'free'`). A settings toggle in
   the reader panel: «перевод: бесплатный / ИИ». When AI isn't configured, show the AI option disabled with
   a short hint + the existing "enable AI" link (`AiUpsellLink`), so the choice is discoverable but safe.
3. **Router helper.** A single `reader/translate.ts › translateReaderText(text, { mode, config })`:
   - `mode==='ai' && isConfigured(config)` → `aiTranslate(config, text)`, and on throw **fall back** to
     `mymemoryTranslate(text)` so a network/AI failure still yields the free result.
   - else → the free `translateText(text)`.
   Return `string | null` (null = show the existing "unavailable" state). Keep BOTH caches (Dexie for free,
   localStorage for AI) — they don't collide.
4. **Wire-in.** Route the sentence "ru" toggle and the phrase popover through the helper. The sentence
   toggle lives in the **memoized `Paragraph`** — it must receive `translation` mode + `aiConfig` (or a
   ready-made `translate` callback) as **props** rather than subscribing to the AI store inside `Paragraph`
   (a store subscription there would re-render every paragraph on any AI-config change and break the memo
   discipline). The phrase popover is in `ReadingText`, which already reads `useAiStore`.

## Privacy / cost (call out; user has opted into BYOK AI)
- AI translation sends the sentence/phrase text to the user's configured model — acceptable because the
  user explicitly turns it on, but note it in the toggle's hint. Books still never leave the device except
  the specific sentence/phrase the user asks to translate.
- Per-sentence AI calls could add up; the localStorage cache (keyed by model+text) means each sentence is
  paid for once. Consider a soft note but no hard limit (the AI limits layer already exists —
  `ai/limits.ts` — check whether translations should count against it).

## Risks / for the audit
- `Paragraph` memoization: passing a new `translate` callback each render would defeat the memo — pass a
  stable ref (like `onRead`/`onReadSentence`) or pass primitive `translation` + `config` and build the call
  inside. Audit the exact prop shape.
- Two functions named `translateText` (vocab vs ai) — avoid import ambiguity; name the AI one distinctly.
- Fallback correctness: AI selected + offline → must degrade to MyMemory (also offline → null → visible
  "unavailable"), never hang.
- Should the WORD popover translation (`translateWord`, and the AI `wordInContext`) also respect the
  setting, or stay as-is? (wordInContext is already AI and separate — probably leave; confirm scope is
  sentences+phrases only.)
- Cache key collisions / stale caches; `ai/limits` interaction; does the setting belong in reader settings
  or global settings?

## Test / verify
- Manual: with AI off, sentence/phrase translate via MyMemory as today. With AI on + configured, they use
  the model; toggling the setting switches source; AI failure falls back to free. `build`, `lint`, `test`.

## Audit revisions (independent review — MUST be implemented)
Verdict REVISE. Real bugs found; fold all of these in:
- **M1 — stale cache on mode switch.** `Paragraph` caches sentence translations in local `trs` keyed by
  sentence index and early-outs if present (`reading-text.tsx:291,301`). Toggling free↔AI would keep
  serving the old translation. Fix: pass BOTH a **stable `onTranslate` callback** (ref +
  `useCallback([])`, mirroring `onReadSentence` at `:698-703`, so `config` never enters `Paragraph`) AND a
  **primitive `translateMode: 'free'|'ai'`** prop; key `trs` by `` `${translateMode}:${idx}` ``. Re-route
  BOTH `toggleSentence` (`:303`) and `setPhraseText` (`:533`) through the new helper.
- **M2 — AI cache poisoning.** `ask` caches BEFORE returning (`functions.ts:19-34`) and never validates; a
  model that echoes English / says "can't translate" gets persisted and then permanently fails the
  `hasCyrillic` check → stuck on MyMemory. Give `aiTranslate` its OWN validated cache path (only cache when
  the result is Cyrillic/non-empty); do NOT reuse `ask` unvalidated.
- **M3 — store AI translations in Dexie, not localStorage.** `cacheSet` swallows quota errors; a book's
  worth of `ai:` localStorage entries fills ~5 MB and then `explainError`/`wordInContext` also stop caching
  app-wide. Reuse `db.translations` with key `ai:${model}:${text}` (no collision with the free path's bare
  keys; inherits IndexedDB quota). The two paths can't share the bare key (`.get` returns one row).
- **M4 — fallback calls a non-existent fn.** Use the exported `translateText` (`translate.ts:52`), not
  `mymemoryTranslate` (`mymemory` is unexported). Bonus: reuse gives Dexie cache + 480-char chunking.
- **Design simplification:** a boolean `aiTranslation` (default **false**), gated on `isConfigured`, over
  a `'free'|'ai'` enum. **Reject an `'auto'` mode** — it silently spends tokens per sentence for anyone who
  enabled AI for hints/exercises. Explicit opt-in.
- **Doc fixes:** `ReadingText` does NOT already read `useAiStore` (only its import + `WordToken` do) — the
  parent must ADD `useReaderSettings(s=>s.aiTranslation)` + `useAiStore(s=>s.config)`. `translateWord`/word
  popover stays as-is (already two-tier: quick gloss + `wordInContext`). No `ai/limits` integration needed
  (nothing enforces limits; `complete` only records).
- **Cost/UX (not a blocker):** set the translator persona `temperature≈0.2`; wire the existing `AbortSignal`
  so switching sentences cancels an in-flight AI call (the 4×-retry backoff can otherwise hang "translating…"
  for seconds). Add a one-line toggle hint: "sends the text to your AI provider".
