import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, Feature, StudioState } from '../src/shared/types';
import type { PinnedInstruction } from '../src/shared/instructions';
import { subscribe } from './bridge';
export function PinnedInstructions({
  feature,
  state,
  dispatch,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: (m: ClientMessage) => void;
}) {
  const [text, setText] = useState(''),
    [scope, setScope] = useState<'task' | 'project'>('task');
  const [editing, setEditing] = useState<PinnedInstruction>();
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const request = useRef('');
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type !== 'instructionSaved' || m.requestId !== request.current) return;
        setPending(false);
        setError(m.error ?? '');
        if (!m.error) {
          setText('');
          setEditing(undefined);
        }
      }),
    [],
  );
  const save = (value: string, targetScope = scope, item = editing, active = true) => {
    request.current = crypto.randomUUID();
    setPending(true);
    setError('');
    dispatch({
      type: 'pinInstruction',
      featureId: feature.id,
      scope: targetScope,
      id: item?.id ?? crypto.randomUUID(),
      expectedRevision: item?.revision ?? 0,
      text: value,
      active,
      requestId: request.current,
    });
  };
  const entries = [
    ...(state.settings.instructions ?? []).map((item) => ({ item, scope: 'project' as const })),
    ...(feature.instructions ?? []).map((item) => ({ item, scope: 'task' as const })),
  ];
  return (
    <details className="pinned-instructions work-secondary">
      <summary>Consignes épinglées · {entries.filter((e) => e.item.active).length}</summary>
      <p className="field-help">
        Portée projet : le projet principal de cette session. En pair, une modification est aussi
        transmise dans le chat en cours ; en solo, elle accompagne le prochain échange. Pour
        réorienter immédiatement, utilise l’arrêt.
      </p>
      {entries.map(({ item, scope: kind }) => (
        <article key={`${kind}:${item.id}`}>
          <strong>
            {kind === 'task' ? 'Tâche' : 'Projet'} · v{item.revision}
            {!item.active && ' · Désactivée'}
          </strong>
          <p>{item.text}</p>
          <button
            className="text-button"
            disabled={pending || feature.archived}
            onClick={() => {
              setEditing(item);
              setText(item.text);
              setScope(kind);
            }}
          >
            Modifier
          </button>
          <button
            className="text-button"
            disabled={pending || feature.archived}
            onClick={() => save(item.text, kind, item, !item.active)}
          >
            {item.active ? 'Désactiver' : 'Réactiver'}
          </button>
          {!!item.history.length && (
            <details>
              <summary>Historique</summary>
              {item.history.map((h) => (
                <p key={h.revision}>
                  v{h.revision} · {h.text}
                </p>
              ))}
            </details>
          )}
        </article>
      ))}
      {!feature.archived && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) save(text.trim());
          }}
        >
          <label className="field">
            <span>Consigne</span>
            <textarea value={text} maxLength={10000} onChange={(e) => setText(e.target.value)} />
          </label>
          <select
            aria-label="Portée de la consigne"
            disabled={!!editing}
            value={scope}
            onChange={(e) => setScope(e.target.value as 'task' | 'project')}
          >
            <option value="task">Cette tâche</option>
            <option value="project">Ce projet</option>
          </select>
          <button className="button secondary" disabled={pending || !text.trim()}>
            Enregistrer la consigne
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
