/** Runs in the target document. No DOM/style insertion, and no reads of values before origin/auth gates. */
export function installRecorder(config: {
  binding: string;
  origins: string[];
  generation: number;
}) {
  const win = window as unknown as Record<string, any>;
  const key = '__keraiNavigationRecorder';
  win[key]?.stop?.();
  let active = false;
  let sequence = 0;
  const allowed = () => active && config.origins.includes(location.origin);
  const sensitive = (element: Element) =>
    element.closest(
      'input[type="password"], [autocomplete="username"], [autocomplete="current-password"], [autocomplete="new-password"], [autocomplete="one-time-code"], [data-private], [data-sensitive]',
    ) ||
    /password|passwd|secret|token|credential|login|username|email|otp/i.test(
      [element.getAttribute('name'), element.id, element.getAttribute('autocomplete')].join(' '),
    );
  const target = (element: Element) => {
    const testId = element.getAttribute('data-testid');
    if (testId && document.querySelectorAll(`[data-testid="${CSS.escape(testId)}"]`).length === 1)
      return { strategy: 'testId', value: testId };
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
      return { strategy: 'css', value: `#${CSS.escape(element.id)}` };
    const label = element.getAttribute('aria-label');
    if (label) return { strategy: 'label', value: label.slice(0, 200) };
    const text = element.textContent?.trim().slice(0, 160);
    if (text && ['BUTTON', 'A'].includes(element.tagName))
      return {
        strategy: 'role',
        value: element.tagName === 'BUTTON' ? 'button' : 'link',
        name: text,
      };
    return undefined;
  };
  const emit = (step: unknown) => {
    if (!allowed()) return;
    // This is a proposal only: the worker checks source frame, epoch, shape and target uniqueness again.
    void win[config.binding]({ generation: config.generation, sequence: ++sequence, step }).catch(
      () => {},
    );
  };
  const click = (event: MouseEvent) => {
    if (!allowed() || !event.isTrusted) return;
    const element = (event.target as Element)?.closest('button,a,[role="button"],[data-testid]');
    if (!element || sensitive(element) || ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName))
      return;
    const locator = target(element);
    if (locator) emit({ action: 'click', target: locator, effect: 'unknown' });
  };
  const change = (event: Event) => {
    if (!allowed() || !event.isTrusted) return;
    const element = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!element || sensitive(element)) return;
    const locator = target(element);
    if (!locator) return;
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type))
      emit({ action: 'check', target: locator, checked: element.checked, effect: 'unknown' });
    else if (element instanceof HTMLSelectElement)
      emit({
        action: 'select',
        target: locator,
        value: { literal: element.value.slice(0, 4000) },
        effect: 'unknown',
      });
    else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
      emit({
        action: 'fill',
        target: locator,
        value: { literal: element.value.slice(0, 4000) },
        effect: 'unknown',
      });
  };
  const keydown = (event: KeyboardEvent) => {
    if (!allowed() || !event.isTrusted || !['Enter', 'Escape'].includes(event.key)) return;
    const element = event.target as Element;
    if (!element || sensitive(element)) return;
    const locator = target(element);
    if (locator) emit({ action: 'press', target: locator, key: event.key, effect: 'unknown' });
  };
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  const scroll = (event: Event) => {
    if (!allowed() || !event.isTrusted) return;
    clearTimeout(scrollTimer);
    const element =
      event.target instanceof Element &&
      event.target !== document.documentElement &&
      event.target !== document.body
        ? event.target
        : undefined;
    scrollTimer = setTimeout(() => {
      if (!allowed()) return;
      if (element) {
        const locator = target(element);
        if (!locator) {
          void win[config.binding]({
            generation: config.generation,
            sequence: ++sequence,
            unsupported: 'scroll-target',
          }).catch(() => {});
          return;
        }
        emit({
          action: 'scroll',
          target: locator,
          x: Math.round(element.scrollLeft),
          y: Math.round(element.scrollTop),
          effect: 'read',
        });
      } else
        emit({
          action: 'scroll',
          x: Math.round(window.scrollX),
          y: Math.round(window.scrollY),
          effect: 'read',
        });
    }, 180);
  };
  const stop = () => {
    active = false;
    clearTimeout(scrollTimer);
    document.removeEventListener('click', click, true);
    document.removeEventListener('change', change, true);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('scroll', scroll, true);
  };
  win[key] = {
    stop,
    start: () => {
      stop();
      if (!config.origins.includes(location.origin)) return;
      active = true;
      document.addEventListener('click', click, true);
      document.addEventListener('change', change, true);
      document.addEventListener('keydown', keydown, true);
      window.addEventListener('scroll', scroll, true);
    },
  };
}
