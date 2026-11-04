export const ABOUT_ENTRIES = {
  journey: {
    term: 'journey',
    ru: 'путешествие',
    en: 'a trip from one place to another',
    level: 1,
    kind: 'word',
  },
  serene: {
    term: 'serene',
    ru: 'безмятежный, спокойный',
    en: 'calm and peaceful',
    level: 3,
    kind: 'word',
  },
  phrase: {
    term: 'take your time',
    ru: 'не торопись',
    en: 'do it without hurrying',
    level: 1,
    kind: 'phrase',
  },
} as const;
export const ABOUT_PHRASE = ['Take', 'your', 'time'];
export type AboutDemoId = keyof typeof ABOUT_ENTRIES;
export type AboutDemoState = {
  mode: 'word' | 'phrase';
  stage: 'read' | 'saved' | 'review' | 'done';
  selected: AboutDemoId | null;
  range: [number, number | null] | null;
  records: Partial<Record<AboutDemoId, { grade: number | null }>>;
  revealed: boolean;
};
export type AboutDemoAction =
  | { type: 'mode'; mode: AboutDemoState['mode'] }
  | { type: 'word'; id: 'journey' | 'serene' }
  | { type: 'token'; index: number }
  | { type: 'grade'; value: number }
  | { type: 'read' | 'save' | 'review' | 'reveal' | 'change-grade' | 'reset' };

export const initialAboutDemo: AboutDemoState = {
  mode: 'word',
  stage: 'read',
  selected: null,
  range: null,
  records: {},
  revealed: false,
};
export function aboutDemoReducer(
  state: AboutDemoState,
  action: AboutDemoAction
): AboutDemoState {
  switch (action.type) {
    case 'reset':
      return initialAboutDemo;
    case 'read':
      return {
        ...state,
        stage: 'read',
        selected: null,
        range: null,
        revealed: false,
      };
    case 'mode':
      return {
        ...state,
        mode: action.mode,
        stage: 'read',
        selected: null,
        range: null,
        revealed: false,
      };
    case 'word':
      return state.mode === 'word' && state.stage === 'read'
        ? { ...state, selected: action.id }
        : state;
    case 'token': {
      if (
        state.mode !== 'phrase' ||
        state.stage !== 'read' ||
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index >= ABOUT_PHRASE.length
      )
        return state;
      if (!state.range || state.range[1] !== null)
        return { ...state, selected: null, range: [action.index, null] };
      const low = Math.min(state.range[0], action.index),
        high = Math.max(state.range[0], action.index);
      return {
        ...state,
        range: [state.range[0], action.index],
        selected: low === 0 && high === 2 ? 'phrase' : null,
      };
    }
    case 'save':
      return state.stage === 'read' && state.selected
        ? {
            ...state,
            stage: 'saved',
            records: {
              ...state.records,
              [state.selected]: state.records[state.selected] ?? {
                grade: null,
              },
            },
          }
        : state;
    case 'review':
      return state.selected && state.records[state.selected]
        ? { ...state, stage: 'review', revealed: false }
        : state;
    case 'reveal':
      return state.stage === 'review' ? { ...state, revealed: true } : state;
    case 'grade':
      return state.stage === 'review' &&
        state.revealed &&
        state.selected &&
        state.records[state.selected] &&
        Number.isInteger(action.value) &&
        action.value >= 1 &&
        action.value <= 4
        ? {
            ...state,
            stage: 'done',
            records: {
              ...state.records,
              [state.selected]: { grade: action.value },
            },
          }
        : state;
    case 'change-grade':
      return state.stage === 'done'
        ? { ...state, stage: 'review', revealed: true }
        : state;
  }
}
