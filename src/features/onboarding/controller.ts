import { driver } from 'driver.js';
import type { Driver, PopoverDOM } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useAccount } from '@/features/account/store';
import { subscribeDataScope } from '@/features/account/dataScope';
import { track } from '@/features/analytics/analytics';
import type { UiLang } from '@/features/i18n/uiLang';
import { suspendReading } from '@/shared/lib/reading-suspension';
import { resolveSteps, tourFor } from './content';
import type { ResolvedStep, TourDefinition } from './content';
import { adoptTourMemory, readTour, rememberTour, tourOwner } from './memory';
import { useOnboarding } from './state';

export class ContextualTour {
  private context: TourDefinition | null = null;
  private path = '';
  private lang: UiLang = 'ru';
  private owner = tourOwner();
  private adoptFrom: string | null = null;
  private instance: Driver | null = null;
  private steps: ResolvedStep[] = [];
  private step: ResolvedStep | null = null;
  private trigger: HTMLElement | null = null;
  private scroll: { x: number; y: number } | null = null;
  private inert = false;
  private releaseReading: (() => void) | null = null;
  private restoreScrollbar: (() => void) | null = null;
  private epoch = 0;
  private frame = 0;
  private autoTimer = 0;
  private disposed = false;
  private away = false;
  private ignoreEscapeUp = false;
  private root = document.getElementById('root');
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private mobile = matchMedia('(max-width: 700px)');
  private example = document.createElement('dialog');
  private announcer = document.createElement('span');
  private media: HTMLImageElement;
  private mediaStatus: HTMLElement;
  private mediaError: HTMLElement;
  private motion: HTMLButtonElement;
  private chooser: HTMLSelectElement;
  private topic = '';
  private playing = false;
  private mediaFailed = false;
  private mediaSerial = 0;
  private observer: MutationObserver;
  private unsubscribers: (() => void)[];

  constructor() {
    this.example.className = 'ct-example';
    this.example.setAttribute('aria-labelledby', 'ct-example-title');
    this.example.innerHTML =
      '<header><h2 id="ct-example-title"></h2><button type="button" data-example="close">×</button></header><label class="ct-example-choice" hidden><span></span><select></select></label><div class="ct-example-media"><img alt="" draggable="false"><p class="ct-example-error" hidden></p></div><footer><span class="ct-example-state" role="status"></span><div class="ct-example-buttons"><button type="button" data-example="motion"></button><button type="button" data-example="replay"></button></div></footer><small></small>';
    this.announcer.className = 'ct-announcer';
    this.announcer.setAttribute('role', 'status');
    document.body.append(this.example, this.announcer);
    this.media = this.example.querySelector('img')!;
    this.mediaStatus = this.example.querySelector('.ct-example-state')!;
    this.mediaError = this.example.querySelector('.ct-example-error')!;
    this.motion = this.example.querySelector('[data-example=motion]')!;
    this.chooser = this.example.querySelector('select')!;
    this.example.addEventListener('click', this.onExampleClick);
    this.example.addEventListener('cancel', this.onExampleCancel);
    this.chooser.addEventListener('change', this.onChoice);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('keyup', this.onKey, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('focusout', this.schedule);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    window.addEventListener('resize', this.schedule);
    window.addEventListener('storage', this.onStorage);
    this.mobile.addEventListener('change', this.onVariant);
    this.reduced.addEventListener('change', this.onReduced);
    document.fonts?.addEventListener('loadingdone', this.schedule);
    document.fonts?.addEventListener('loadingerror', this.schedule);
    this.observer = new MutationObserver(this.schedule);
    this.observer.observe(document.body, { childList: true });
    if (this.root)
      this.observer.observe(this.root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'hidden',
          'open',
          'disabled',
          'data-onboarding-ready',
        ],
      });
    this.unsubscribers = [
      subscribeDataScope((change) => {
        this.close(false, false);
        this.adoptFrom = change === 'adopt-anonymous' ? this.owner : null;
        queueMicrotask(this.checkOwner);
      }),
      useAccount.subscribe(this.checkOwner),
    ];
    void document.fonts?.ready.then(this.schedule);
  }

  private t(ru: string, en: string) {
    return this.lang === 'ru' ? ru : en;
  }
  update(path: string, lang: UiLang) {
    if (path !== this.path || lang !== this.lang)
      this.close(true, path === this.path);
    this.path = path;
    this.lang = lang;
    this.context = tourFor(path, lang);
    this.sync();
  }
  private announce(text: string) {
    this.announcer.textContent = text;
  }
  private schedule = () => {
    if (this.disposed || this.away || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  };
  private checkOwner = () => {
    if (this.disposed) return;
    const next = tourOwner();
    if (next !== this.owner) {
      this.close(false, false);
      if (this.adoptFrom) adoptTourMemory(this.adoptFrom, next);
      this.adoptFrom = null;
      this.owner = next;
    }
    this.schedule();
  };
  private onStorage = (event: StorageEvent) => {
    if (event.key === 'oxford-account' || event.key === null) this.checkOwner();
    else this.schedule();
  };
  private resolved() {
    if (!this.context) return [];
    const ready =
      this.context.key === 'today'
        ? '.course-page'
        : this.context.key === 'grammar'
          ? '.grammar-page'
          : null;
    if (
      ready &&
      document.querySelector(ready)?.getAttribute('data-onboarding-ready') ===
        'false'
    )
      return [];
    if (
      this.context.key === 'vocabulary' &&
      document.querySelector('[data-onboarding="vocabulary-add"]:disabled')
    )
      return [];
    if (
      this.context.key === 'reader' &&
      !document.querySelector('[data-reader-text]')
    )
      return [];
    return resolveSteps(document, this.context);
  }
  private blocked() {
    if (document.querySelector('[data-welcome-pending="true"]')) return true;
    return [
      ...document.querySelectorAll<HTMLElement>(
        'dialog[open]:not(.ct-example), [role="dialog"]:not(.ct-popover):not(.ct-example)'
      ),
    ].some(
      (node) =>
        node.getClientRects().length &&
        !node.closest('[hidden], dialog:not([open])')
    );
  }
  private sync() {
    if (this.disposed || this.away) return;
    if (
      this.instance &&
      this.step &&
      (!this.step.element.isConnected ||
        !this.step.element.getClientRects().length)
    ) {
      this.close(false, true);
      this.announce(
        this.t(
          'Элемент страницы изменился. Запустите подсказки заново через «?».',
          'This part of the page changed. Restart help with “?”.'
        )
      );
    }
    if (this.instance && this.blocked()) this.close(true, false);
    const ready = this.resolved().length > 0;
    const state = useOnboarding.getState();
    if (
      state.context !== this.context ||
      state.ready !== ready ||
      state.start !== this.manual
    )
      useOnboarding.setState({
        context: this.context,
        ready,
        start: this.manual,
      });
    window.clearTimeout(this.autoTimer);
    if (
      !ready ||
      !this.context?.auto ||
      this.instance ||
      document.hidden ||
      document.fonts?.status === 'loading' ||
      this.blocked() ||
      document.activeElement?.matches(
        'input,textarea,select,[contenteditable=true]'
      ) ||
      readTour(this.owner, this.context.key) !== null
    )
      return;
    const epoch = this.epoch;
    this.autoTimer = window.setTimeout(() => {
      if (
        epoch === this.epoch &&
        !document.hidden &&
        !this.blocked() &&
        !document.activeElement?.matches(
          'input,textarea,select,[contenteditable=true]'
        )
      )
        this.start(false);
    }, 450);
  }
  private manual = (trigger: HTMLElement) => this.start(true, trigger);
  private start(manual: boolean, trigger?: HTMLElement) {
    if (
      !this.context ||
      this.disposed ||
      this.away ||
      document.hidden ||
      this.blocked()
    )
      return;
    this.close(false, false);
    let steps = this.resolved();
    if (!steps.length) return;
    if (!manual) steps = steps.slice(0, 3);
    if (
      !manual &&
      (readTour(this.owner, this.context.key) !== null ||
        !rememberTour(this.owner, this.context.key, 'shown'))
    )
      return;
    this.steps = steps;
    this.trigger =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    this.scroll = { x: scrollX, y: scrollY };
    this.inert = this.root?.inert ?? false;
    this.releaseReading = suspendReading();
    const html = document.documentElement;
    if (window.CSS?.supports?.('scrollbar-gutter', 'stable')) {
      const gutter = html.style.getPropertyValue('scrollbar-gutter');
      const priority = html.style.getPropertyPriority('scrollbar-gutter');
      if (getComputedStyle(html).scrollbarGutter === 'auto')
        html.style.setProperty('scrollbar-gutter', 'stable');
      this.restoreScrollbar = () => {
        if (gutter)
          html.style.setProperty('scrollbar-gutter', gutter, priority);
        else html.style.removeProperty('scrollbar-gutter');
      };
    }
    if (this.root) this.root.inert = true;
    void track('contextual_tour_started', {
      page: this.context.key,
      mode: manual ? 'manual' : 'auto',
    });
    try {
      this.instance = driver({
        animate: !this.reduced.matches,
        duration: 180,
        smoothScroll: false,
        overlayColor: '#0a0b10',
        overlayOpacity: 0.68,
        allowClose: true,
        overlayClickBehavior: 'close',
        disableActiveInteraction: true,
        showProgress: true,
        progressText: this.t(
          '{{current}} из {{total}}',
          '{{current}} of {{total}}'
        ),
        nextBtnText: this.t('Далее', 'Next'),
        prevBtnText: this.t('Назад', 'Back'),
        doneBtnText: this.t('Готово', 'Done'),
        stagePadding: 8,
        stageRadius: 10,
        popoverOffset: 12,
        popoverClass: 'ct-popover',
        steps: steps.map((item) => ({
          element: item.element,
          popover: {
            title: item.title,
            description: item.body,
            side: 'bottom',
            align: 'start',
          },
        })),
        onPopoverRender: this.render,
        onNextClick: () => {
          if (this.instance?.isLastStep()) {
            rememberTour(this.owner, this.context!.key, 'completed');
            void track('contextual_tour_completed', {
              page: this.context!.key,
            });
            this.close(false, true);
            this.announce(
              this.t(
                'Знакомство завершено. Подсказки можно повторить через «?».',
                'You are ready. Repeat help any time with “?”.'
              )
            );
          } else this.instance?.moveNext();
        },
        onDestroyStarted: () => this.close(true, true),
      });
      this.instance.drive();
    } catch {
      this.close(false, true);
      this.announce(
        this.t(
          'Не удалось открыть подсказки. Попробуйте ещё раз.',
          'Help could not open. Please try again.'
        )
      );
    }
  }
  private render = (popover: PopoverDOM) => {
    this.step = this.steps[this.instance?.getActiveIndex() ?? 0] ?? null;
    if (!this.step || !this.context) return;
    popover.wrapper.style.display = 'flex';
    popover.wrapper.setAttribute('aria-modal', 'true');
    popover.wrapper.dataset.page = this.context.key;
    popover.closeButton.setAttribute(
      'aria-label',
      this.t('Закрыть подсказки', 'Close help')
    );
    popover.title.tabIndex = -1;
    popover.title.setAttribute('role', 'heading');
    popover.title.setAttribute('aria-level', '2');
    const kicker = document.createElement('p');
    kicker.className = 'ct-kicker';
    kicker.textContent = this.context.title;
    if (this.step.media.length) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ct-show-example';
      button.textContent = this.t('▷ Показать пример', '▷ Show example');
      button.addEventListener('click', this.openExample);
      popover.description.append(button);
    }
    const body = document.createElement('div');
    body.className = 'ct-popover-body';
    body.append(kicker, popover.title, popover.description);
    popover.wrapper.insertBefore(body, popover.footer);
    const epoch = this.epoch;
    requestAnimationFrame(() => {
      if (this.instance && epoch === this.epoch && !this.example.open)
        popover.title.focus({ preventScroll: true });
    });
  };

  private openExample = () => {
    if (!this.instance || !this.step?.media.length || this.example.open) return;
    this.example.querySelector('h2')!.textContent = this.step.title;
    this.example
      .querySelector('[data-example=close]')!
      .setAttribute('aria-label', this.t('Закрыть пример', 'Close example'));
    this.example.querySelector('[data-example=replay]')!.textContent = this.t(
      'Повторить',
      'Replay'
    );
    this.example.querySelector('small')!.textContent = this.t(
      'Запись экрана · учебный пример',
      'Screen recording · learning example'
    );
    this.mediaError.textContent = this.t(
      'Не удалось загрузить запись. Закройте пример: текст подсказки остаётся доступен.',
      'The recording could not load. Close the example to return to the written help.'
    );
    this.example.querySelector('label span')!.textContent = this.t(
      'Пример',
      'Example'
    );
    this.chooser.setAttribute(
      'aria-label',
      this.t('Вариант примера', 'Example topic')
    );
    this.chooser.replaceChildren();
    const labels: Record<string, string> = {
      'reader-context': this.t('Значение с AI', 'AI meaning'),
      'reader-simplify': this.t('Упростить английский', 'Simplify English'),
      'reader-grammar': this.t('Объяснить грамматику', 'Explain grammar'),
    };
    for (const topic of this.step.media) {
      const option = document.createElement('option');
      option.value = topic;
      option.textContent = labels[topic] ?? this.step.title;
      this.chooser.append(option);
    }
    this.chooser.closest('label')!.hidden = this.step.media.length < 2;
    this.topic = this.step.media[0] ?? '';
    this.media.alt =
      this.t('Демонстрационная запись: ', 'Recorded example: ') +
      this.step.title;
    this.example.showModal();
    this.setMedia(!this.reduced.matches);
    this.example
      .querySelector<HTMLButtonElement>('[data-example=close]')!
      .focus({ preventScroll: true });
    void track('contextual_example_opened', { page: this.context!.key });
  };
  private setMedia(play: boolean) {
    if (!this.topic || !this.example.open) return;
    this.playing = play && !document.hidden;
    this.mediaFailed = false;
    const serial = ++this.mediaSerial;
    const base = `/onboarding/2026-11-02/${this.topic}-${this.mobile.matches ? 'mobile' : 'desktop'}`;
    this.mediaError.hidden = true;
    this.media.hidden = false;
    this.media.onload = () => {
      if (serial !== this.mediaSerial || !this.example.open) return;
      this.mediaStatus.textContent = this.mediaFailed
        ? this.t(
            'Запись недоступна · статичный кадр',
            'Recording unavailable · still image'
          )
        : this.playing
          ? this.t('Пример повторяется по кругу', 'Example loops automatically')
          : this.t('Статичный кадр', 'Still image');
    };
    this.media.onerror = () => {
      if (serial !== this.mediaSerial || !this.example.open) return;
      this.playing = false;
      this.mediaFailed = true;
      this.motion.textContent = this.t('Загрузить ещё раз', 'Load again');
      this.mediaStatus.textContent = this.t(
        'Запись недоступна',
        'Recording unavailable'
      );
      if (new URL(this.media.src).pathname.endsWith('.gif'))
        this.media.src = base + '.png';
      else {
        this.media.hidden = true;
        this.mediaError.hidden = false;
      }
    };
    this.media.src = base + (this.playing ? `.gif?play=${serial}` : '.png');
    this.motion.textContent = this.playing
      ? this.t('Остановить', 'Stop')
      : this.t('Воспроизвести', 'Play');
    this.mediaStatus.textContent = this.t(
      'Загружаем пример…',
      'Loading example…'
    );
  }
  private closeExample(restore = true) {
    this.mediaSerial++;
    this.playing = false;
    this.media.onload = null;
    this.media.onerror = null;
    this.media.removeAttribute('src');
    if (this.example.open) this.example.close();
    if (restore)
      document.querySelector<HTMLButtonElement>('.ct-show-example')?.focus();
  }
  private onExampleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const action =
      event.target.closest<HTMLElement>('[data-example]')?.dataset.example;
    if (action === 'close') this.closeExample();
    else if (action === 'motion')
      this.setMedia(this.mediaFailed || !this.playing);
    else if (action === 'replay') this.setMedia(true);
  };
  private onExampleCancel = (event: Event) => {
    event.preventDefault();
    this.closeExample();
  };
  private onChoice = () => {
    this.topic = this.chooser.value;
    this.setMedia(!this.reduced.matches);
  };
  private onVariant = () => {
    if (this.example.open) this.setMedia(false);
    this.instance?.refresh();
    this.schedule();
  };
  private onReduced = () => {
    if (this.reduced.matches && this.example.open) this.setMedia(false);
  };
  private onVisibility = () => {
    if (document.hidden && this.example.open) this.setMedia(false);
    else this.schedule();
  };
  private onPageHide = () => {
    this.away = true;
    this.close(false, false);
  };
  private onPageShow = () => {
    this.away = false;
    this.checkOwner();
    this.schedule();
  };
  private onKey = (event: KeyboardEvent) => {
    if (
      this.ignoreEscapeUp &&
      event.type === 'keyup' &&
      event.key === 'Escape'
    ) {
      this.ignoreEscapeUp = false;
      event.stopImmediatePropagation();
      return;
    }
    if (this.example.open) {
      if (['Tab', 'Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key))
        event.stopImmediatePropagation();
      if (event.type === 'keydown' && event.key === 'Escape') {
        event.preventDefault();
        this.ignoreEscapeUp = true;
        this.closeExample();
      }
      return;
    }
    if (!this.instance || event.type !== 'keydown' || event.key !== 'Tab')
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const controls = [
      ...document.querySelectorAll<HTMLButtonElement>('.ct-popover button'),
    ].filter((node) => !node.disabled && node.getClientRects().length);
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey
      ? index <= 0
        ? controls.length - 1
        : index - 1
      : (index + 1) % controls.length;
    controls[next]?.focus();
  };
  close(remember = true, restore = true) {
    this.epoch++;
    window.clearTimeout(this.autoTimer);
    this.closeExample(false);
    const instance = this.instance;
    this.instance = null;
    if (!instance && !this.releaseReading) return;
    try {
      instance?.destroy();
    } finally {
      this.restoreScrollbar?.();
      this.restoreScrollbar = null;
      if (this.root) this.root.inert = this.inert;
      if (remember && this.context) {
        rememberTour(this.owner, this.context.key, 'dismissed');
        void track('contextual_tour_dismissed', { page: this.context.key });
      }
      if (restore && this.scroll)
        window.scrollTo({
          top: this.scroll.y,
          left: this.scroll.x,
          behavior: 'instant',
        });
      this.scroll = null;
      this.releaseReading?.();
      this.releaseReading = null;
      if (restore && this.trigger?.isConnected)
        this.trigger.focus({ preventScroll: true });
      this.step = null;
      this.steps = [];
    }
  }
  destroy() {
    this.disposed = true;
    this.close(false, false);
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('keyup', this.onKey, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('focusout', this.schedule);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    window.removeEventListener('resize', this.schedule);
    window.removeEventListener('storage', this.onStorage);
    this.mobile.removeEventListener('change', this.onVariant);
    this.reduced.removeEventListener('change', this.onReduced);
    document.fonts?.removeEventListener('loadingdone', this.schedule);
    document.fonts?.removeEventListener('loadingerror', this.schedule);
    this.example.remove();
    this.announcer.remove();
    useOnboarding.setState({ context: null, ready: false, start: null });
  }
}
