import {
  Component,
  lazy,
  Suspense,
  createElement,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react';

class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="empty-state" role="alert">
        <p>Cet écran n’a pas pu être chargé. Vos données enregistrées sont conservées.</p>
        <button onClick={() => location.reload()}>Recharger le cockpit</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

/** Keep the navigation usable while a secondary screen and its assets are loading. */
export function deferred<T extends ComponentType<any>>(load: () => Promise<T>) {
  const Screen = lazy(async () => ({ default: await load() }));
  return function DeferredScreen(props: ComponentProps<T>) {
    return (
      <ScreenBoundary>
        <Suspense
          fallback={
            <p className="muted" role="status">
              Chargement de l’écran…
            </p>
          }
        >
          {createElement(Screen, props)}
        </Suspense>
      </ScreenBoundary>
    );
  };
}
