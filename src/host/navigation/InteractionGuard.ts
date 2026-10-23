/** Temporary listeners only. Unexpected native interaction invalidates managed observations. */
export function installInteractionGuard(config: {
  binding: string;
  origins: string[];
  generation: number;
}) {
  const win = window as unknown as Record<string, any>;
  win.__keraiInteractionGuard?.stop?.();
  let expected: { element: Element; kind: 'pointer' | 'key'; key?: string } | undefined;
  const observed = (event: Event) => {
    if (!event.isTrusted || !config.origins.includes(location.origin)) return;
    const kind =
      event.type === 'pointerdown' ? 'pointer' : event.type === 'keydown' ? 'key' : 'wheel';
    if (
      expected &&
      expected.kind === kind &&
      event.composedPath().includes(expected.element) &&
      (kind !== 'key' || (event as KeyboardEvent).key === expected.key)
    ) {
      expected = undefined;
      return;
    }
    // No key value, target text, field value or document content crosses this boundary.
    void win[config.binding]({ generation: config.generation }).catch(() => {});
  };
  const stop = () => {
    document.removeEventListener('pointerdown', observed, true);
    document.removeEventListener('keydown', observed, true);
    document.removeEventListener('wheel', observed, true);
    expected = undefined;
  };
  win.__keraiInteractionGuard = {
    stop,
    clear: () => {
      expected = undefined;
    },
    expect: (element: Element, kind: 'pointer' | 'key', key?: string) => {
      expected = { element, kind, key };
    },
  };
  document.addEventListener('pointerdown', observed, true);
  document.addEventListener('keydown', observed, true);
  document.addEventListener('wheel', observed, true);
}
