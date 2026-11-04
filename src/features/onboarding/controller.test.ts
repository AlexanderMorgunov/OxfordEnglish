import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import type { Config, PopoverDOM } from 'driver.js';
const state = vi.hoisted(() => ({ config: null as Config | null, index: 0 }));
vi.mock('driver.js', () => ({
  driver: (config: Config) => {
    state.config = config;
    state.index = 0;
    const render = () => {
      document.querySelector('.ct-popover')?.remove();
      const wrapper = document.createElement('div');
      wrapper.className = 'ct-popover';
      wrapper.setAttribute('role', 'dialog');
      wrapper.innerHTML =
        '<button data-close></button><i></i><h2></h2><div data-description></div><footer><span></span><div><button data-back></button><button data-next></button></div></footer>';
      document.body.append(wrapper);
      const popover: PopoverDOM = {
        wrapper,
        arrow: wrapper.querySelector('i')!,
        title: wrapper.querySelector('h2')!,
        description: wrapper.querySelector('[data-description]')!,
        footer: wrapper.querySelector('footer')!,
        progress: wrapper.querySelector('span')!,
        previousButton: wrapper.querySelector('[data-back]')!,
        nextButton: wrapper.querySelector('[data-next]')!,
        closeButton: wrapper.querySelector('[data-close]')!,
        footerButtons: wrapper.querySelector('footer div')!,
      };
      popover.title.textContent =
        config.steps?.[state.index]?.popover?.title ?? '';
      config.onPopoverRender?.(popover, {
        config,
        state: {},
        driver: {} as never,
        index: state.index,
      });
    };
    return {
      drive: render,
      getActiveIndex: () => state.index,
      isLastStep: () => state.index === config.steps!.length - 1,
      moveNext: () => {
        state.index++;
        render();
      },
      refresh: () => {},
      destroy: () => {
        document.querySelector('.ct-popover')?.remove();
      },
    };
  },
}));
vi.mock('@/features/account/store', () => ({
  useAccount: { subscribe: () => () => {} },
}));
vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
import { ContextualTour } from './controller';
import { readTour } from './memory';
import { useOnboarding } from './state';
import { readingSuspended } from '@/shared/lib/reading-suspension';
let tour: ContextualTour;
const originalShow = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal'
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close'
);
const trigger = () => document.querySelector<HTMLButtonElement>('#help')!;
const start = () => useOnboarding.getState().start!(trigger());
const invoke = (hook: 'onNextClick' | 'onDestroyStarted') =>
  state.config?.[hook]?.(
    undefined,
    {},
    { config: state.config, state: {}, driver: {} as never, index: state.index }
  );
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  state.config = null;
  document.body.innerHTML =
    '<div id="root"><button id="help">Help</button><main><div data-reader-text><p data-para="0"><button data-widx="0:0:5">quiet</button></p></div><button data-onboarding="reader-appearance">Text appearance</button><div class="rd-chapter-finish"><button>Practice</button></div></main></div>';
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() =>
    Object.assign([new DOMRect(0, 0, 100, 30)], { item: () => null })
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  tour = new ContextualTour();
});
afterEach(() => {
  tour?.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  if (originalShow)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      'showModal',
      originalShow
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose)
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

test('automatic intro waits for a portal modal and starts after its removal', async () => {
  const modal = document.createElement('dialog');
  modal.open = true;
  document.body.append(modal);
  tour.update('/library/catalog/fixture', 'en');
  await vi.advanceTimersByTimeAsync(600);
  expect(state.config).toBeNull();
  modal.remove();
  await vi.advanceTimersByTimeAsync(600);
  expect(state.config?.steps).toHaveLength(3);
});

test('reader auto has three steps once; manual help always has six and restarts at one', () => {
  tour.update('/library/another-book', 'en');
  vi.advanceTimersByTime(500);
  expect(state.config?.steps).toHaveLength(3);
  expect(readingSuspended()).toBe(true);
  invoke('onDestroyStarted');
  expect(readingSuspended()).toBe(false);
  expect(readTour('local', 'reader')).toBe('dismissed');
  state.config = null;
  tour.update('/library/another-book', 'en');
  vi.advanceTimersByTime(500);
  expect(state.config).toBeNull();
  start();
  expect(state.config!.steps).toHaveLength(6);
  expect(state.index).toBe(0);
  state.index = 5;
  invoke('onNextClick');
  expect(readTour('local', 'reader')).toBe('completed');
  expect(readingSuspended()).toBe(false);
  start();
  expect(state.index).toBe(0);
  expect(state.config!.steps).toHaveLength(6);
});
test('today is manual and a visible dialog prevents competing help', () => {
  document.querySelector('main')!.innerHTML =
    '<div class="course-resume"></div><a href="/placement">Test</a><a href="/syllabus">Course</a>';
  tour.update('/', 'en');
  vi.advanceTimersByTime(1000);
  expect(state.config).toBeNull();
  const dialog = document.createElement('dialog');
  dialog.open = true;
  document.body.append(dialog);
  start();
  expect(state.config).toBeNull();
  dialog.remove();
  start();
  expect(state.config!.steps).toHaveLength(3);
  expect(document.getElementById('root')!.inert).toBe(true);
  invoke('onDestroyStarted');
  expect(document.getElementById('root')!.inert).toBe(false);
  expect(trigger()).toHaveFocus();
});

test('partial page chrome cannot enable a shortened tour before course content is ready', () => {
  const main = document.querySelector('main')!;
  main.innerHTML =
    '<section class="course-page" data-onboarding-ready="false"><a href="/syllabus">Course</a></section>';
  tour.update('/', 'en');
  expect(useOnboarding.getState().ready).toBe(false);
  main.innerHTML =
    '<section class="course-page" data-onboarding-ready="true"><div class="course-resume"></div><a href="/placement">Test</a><a href="/syllabus">Course</a></section>';
  tour.update('/', 'en');
  start();
  expect(state.config?.steps).toHaveLength(3);
});
test('pagehide cancels pending auto, and changing owner closes an active tour without marking the new owner', () => {
  tour.update('/library/book', 'en');
  window.dispatchEvent(new Event('pagehide'));
  vi.advanceTimersByTime(500);
  expect(state.config).toBeNull();
  window.dispatchEvent(new Event('pageshow'));
  start();
  expect(readingSuspended()).toBe(true);
  localStorage.setItem(
    'oxford-account',
    JSON.stringify({ accountId: 'other-owner' })
  );
  window.dispatchEvent(new StorageEvent('storage', { key: 'oxford-account' }));
  expect(readingSuspended()).toBe(false);
  expect(document.querySelector('.ct-popover')).toBeNull();
  invoke('onNextClick');
  expect(readTour('other-owner', 'reader')).toBeNull();
});
test('blocked tour storage disables auto but leaves manual help available', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  tour.update('/library/book', 'en');
  vi.advanceTimersByTime(500);
  expect(state.config).toBeNull();
  start();
  expect(state.config!.steps).toHaveLength(6);
});
test('examples load only on request; Escape returns to the same step and route changes release the background', () => {
  tour.update('/library/book', 'en');
  start();
  const image = document.querySelector<HTMLImageElement>('.ct-example img')!;
  expect(image.hasAttribute('src')).toBe(false);
  document.querySelector<HTMLButtonElement>('.ct-show-example')!.click();
  expect(document.querySelector<HTMLDialogElement>('.ct-example')!.open).toBe(
    true
  );
  expect(image.src).toContain('reader-word-desktop.gif');
  image.dispatchEvent(new Event('error'));
  expect(image.src).toContain('reader-word-desktop.png');
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })
  );
  expect(document.querySelector<HTMLDialogElement>('.ct-example')!.open).toBe(
    false
  );
  expect(state.index).toBe(0);
  expect(document.querySelector('.ct-show-example')).toHaveFocus();
  tour.update('/grammar', 'en');
  expect(readingSuspended()).toBe(false);
  expect(document.getElementById('root')!.inert).toBe(false);
});
