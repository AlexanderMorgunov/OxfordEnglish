import { beforeEach, expect, test, vi } from 'vitest';

const stamp = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/features/sync/local', () => ({ stampSetting: stamp }));
vi.mock('@/shared/lib/audio', () => ({ setPreferredVoiceURI: vi.fn() }));

const KEY = 'oxford-reader-settings';
const loadWith = async (value: Record<string, unknown>) => {
  localStorage.setItem(KEY, JSON.stringify(value));
  vi.resetModules();
  return import('./settings');
};

beforeEach(() => {
  localStorage.clear();
  stamp.mockClear();
});

test.each([
  [0, 15],
  [1, 17],
  [2, 21],
])('legacy font index %i retains its %ipx size', async (fontStep, pixels) => {
  const { FONT_SIZES, useReaderSettings, effectiveReaderFontStep } =
    await loadWith({ fontStep });
  expect(FONT_SIZES[useReaderSettings.getState().fontStep]).toBe(pixels);
  const state = useReaderSettings.getState();
  expect(state.fontStepExplicit).toBe(true);
  expect(
    FONT_SIZES[
      effectiveReaderFontStep(state.fontStep, state.fontStepExplicit, true)
    ]
  ).toBe(pixels);
});

test.each([
  {},
  { coloring: false },
  { fontStep: -1 },
  { fontStep: 1.5 },
  { fontStep: '2' },
  { fontStep: 9 },
  { fontScaleVersion: 3, fontStep: 0 },
])(
  'missing or invalid legacy size uses the ordinary size: %j',
  async (value) => {
    const { FONT_SIZES, useReaderSettings } = await loadWith(value);
    expect(FONT_SIZES[useReaderSettings.getState().fontStep]).toBe(17);
  }
);

test.each([
  [-10, 0],
  [99, 12],
  [4.6, 5],
  ['large', 2],
  [null, 2],
])(
  'versioned size %j is normalized to index %i',
  async (fontStep, expected) => {
    const { useReaderSettings } = await loadWith({
      fontScaleVersion: 2,
      fontStep,
    });
    expect(useReaderSettings.getState().fontStep).toBe(expected);
  }
);

test('malformed storage uses the ordinary size', async () => {
  localStorage.setItem(KEY, '{');
  vi.resetModules();
  const { useReaderSettings } = await import('./settings');
  expect(useReaderSettings.getState().fontStep).toBe(2);
});

test('every fine size survives reload without a second migration or lost preferences', async () => {
  const preferences = {
    coloring: false,
    fontFamily: null,
    fontStepExplicit: true,
    lineStep: 1,
    voiceURI: 'saved-voice',
    rate: 0.75,
    aiTranslation: true,
    lens: 'grammar',
    bookmarkSort: 'book',
  };
  let settings = await loadWith({ ...preferences, fontStep: 1 });
  for (let step = 0; step < settings.FONT_SIZES.length; step++) {
    settings.useReaderSettings.getState().setFontStep(step);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      ...preferences,
      fontStep: step,
      fontScaleVersion: 2,
    });
    vi.resetModules();
    settings = await import('./settings');
    expect(settings.useReaderSettings.getState()).toMatchObject({
      ...preferences,
      fontStep: step,
    });
  }
  expect(stamp).not.toHaveBeenCalled();
});

test('sync as the first write migrates the local size and never imports a remote size', async () => {
  let settings = await loadWith({ fontStep: 2, lineStep: 1, lens: 'simplify' });
  settings.applyReaderFromSync({
    coloring: false,
    aiTranslation: true,
    fontStep: 0,
  });
  expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
    fontStep: 6,
    fontScaleVersion: 2,
    lineStep: 1,
    lens: 'simplify',
    coloring: false,
    aiTranslation: true,
  });
  vi.resetModules();
  settings = await import('./settings');
  expect(
    settings.FONT_SIZES[settings.useReaderSettings.getState().fontStep]
  ).toBe(21);
  settings.useReaderSettings.getState().setFontStep(9);
  settings.applyReaderFromSync({ coloring: true });
  expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
    fontStep: 9,
    fontScaleVersion: 2,
  });
  expect(stamp).not.toHaveBeenCalled();
});

test('local preferences do not publish stale reader toggles; changing a toggle still syncs', async () => {
  const { useReaderSettings } = await loadWith({
    coloring: false,
    aiTranslation: true,
  });
  const s = useReaderSettings.getState();
  s.setFontStep(8);
  s.setLineStep(1);
  s.setRate(0.75);
  s.setVoiceURI('other-voice');
  s.setLens('grammar');
  s.setBookmarkSort('book');
  expect(stamp).not.toHaveBeenCalled();
  s.toggleColoring();
  expect(stamp).toHaveBeenLastCalledWith('reader', {
    coloring: true,
    aiTranslation: true,
  });
  s.toggleAiTranslation();
  expect(stamp).toHaveBeenLastCalledWith('reader', {
    coloring: true,
    aiTranslation: false,
  });
  expect(stamp).toHaveBeenCalledTimes(2);
});

test('a non-finite setter input cannot leave the reader without a selected size', async () => {
  const { useReaderSettings } = await loadWith({
    fontScaleVersion: 2,
    fontStep: 12,
  });
  useReaderSettings.getState().setFontStep(Number.NaN);
  expect(useReaderSettings.getState().fontStep).toBe(2);
});

test('background settings writes cannot commit an appearance preview and Cancel respects synced toggles', async () => {
  const { useReaderSettings, applyReaderFromSync } = await loadWith({
    fontScaleVersion: 2,
    fontStep: 2,
    fontStepExplicit: false,
    coloring: true,
    fontFamily: 'sans',
  });
  useReaderSettings.getState().beginAppearancePreview();
  useReaderSettings
    .getState()
    .previewAppearance({
      fontStep: 12,
      fontStepExplicit: true,
      fontFamily: 'serif',
    });
  applyReaderFromSync({ coloring: false, aiTranslation: true });
  expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
    fontStep: 2,
    fontStepExplicit: false,
    fontFamily: 'sans',
    coloring: false,
    aiTranslation: true,
  });
  useReaderSettings.getState().setRate(0.75);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
    fontStep: 2,
    fontStepExplicit: false,
    fontFamily: 'sans',
    rate: 0.75,
  });
  expect(useReaderSettings.getState()).toMatchObject({
    fontStep: 12,
    fontStepExplicit: true,
    fontFamily: 'serif',
  });
  useReaderSettings.getState().cancelAppearancePreview();
  expect(useReaderSettings.getState()).toMatchObject({
    fontStep: 2,
    fontStepExplicit: false,
    fontFamily: 'sans',
    coloring: false,
    aiTranslation: true,
    rate: 0.75,
  });
});

test('fresh book text defaults to 22px and ordinary course text stays 17px across unrelated writes and reload', async () => {
  let settings = await loadWith({});
  let state = settings.useReaderSettings.getState();
  expect(state.fontStepExplicit).toBe(false);
  expect(
    settings.FONT_SIZES[
      settings.effectiveReaderFontStep(
        state.fontStep,
        state.fontStepExplicit,
        true
      )
    ]
  ).toBe(22);
  expect(
    settings.FONT_SIZES[
      settings.effectiveReaderFontStep(state.fontStep, state.fontStepExplicit)
    ]
  ).toBe(17);
  state.setRate(0.75);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
    fontStep: 2,
    fontStepExplicit: false,
  });
  vi.resetModules();
  settings = await import('./settings');
  state = settings.useReaderSettings.getState();
  expect(
    settings.FONT_SIZES[
      settings.effectiveReaderFontStep(
        state.fontStep,
        state.fontStepExplicit,
        true
      )
    ]
  ).toBe(22);
});

test('an explicitly chosen 17px remains 17px in books after reload', async () => {
  let settings = await loadWith({});
  settings.useReaderSettings.getState().setFontStep(2);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
    fontStep: 2,
    fontStepExplicit: true,
  });
  vi.resetModules();
  settings = await import('./settings');
  const state = settings.useReaderSettings.getState();
  expect(
    settings.FONT_SIZES[
      settings.effectiveReaderFontStep(
        state.fontStep,
        state.fontStepExplicit,
        true
      )
    ]
  ).toBe(17);
});

test('versioned saved font size without the new marker is conservatively treated as explicit', async () => {
  const settings = await loadWith({ fontStep: 10, fontScaleVersion: 2 });
  const state = settings.useReaderSettings.getState();
  expect(state.fontStepExplicit).toBe(true);
  expect(
    settings.FONT_SIZES[
      settings.effectiveReaderFontStep(
        state.fontStep,
        state.fontStepExplicit,
        true
      )
    ]
  ).toBe(28);
});
