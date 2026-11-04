import { useEffect, useRef, useState } from 'react';
import type { TaskDraft } from '../src/shared/taskDrafts';
import type { ClientMessage } from '../src/shared/types';
import { isHosted, persistView, savedTaskDraft, savedTaskDrafts, subscribe } from './bridge';
type Writer = {
  latest: TaskDraft;
  sent?: { id: string; content: string };
  written?: string;
  timer?: ReturnType<typeof setTimeout>;
  error?: string;
  finished?: boolean;
  dispatch: (m: ClientMessage) => void;
};
const writers = new Map<string, Writer>();
const listeners = new Set<() => void>();
const inform = () => listeners.forEach((listener) => listener());
const payload = (draft: TaskDraft) => JSON.stringify({ ...draft, revision: 0, updatedAt: '' });
function flush(writer: Writer) {
  clearTimeout(writer.timer);
  if (
    !isHosted ||
    writer.sent ||
    writer.error ||
    writer.finished ||
    writer.written === payload(writer.latest)
  )
    return;
  if (
    !writer.latest.revision &&
    !writer.latest.title.trim() &&
    !writer.latest.description.trim() &&
    !writer.latest.images.length
  )
    return;
  const id = crypto.randomUUID();
  writer.sent = { id, content: payload(writer.latest) };
  writer.dispatch({ type: 'saveTaskDraft', draft: { ...writer.latest }, requestId: id });
  inform();
}
subscribe((message) => {
  if (message.type !== 'taskDrafts') return;
  persistView({ taskDrafts: message.drafts });
  for (const writer of writers.values()) {
    if (!writer.sent || writer.sent.id !== message.requestId) continue;
    if (message.error) writer.error = message.error;
    else {
      const saved = message.drafts.find((d) => d.id === writer.latest.id);
      if (saved) writer.latest.revision = saved.revision;
      writer.written = writer.sent.content;
      if (savedTaskDraft()?.id === writer.latest.id && !writer.finished)
        persistView({ taskDraft: writer.latest });
    }
    writer.sent = undefined;
    if (writer.finished && !message.error)
      writer.dispatch({
        type: 'deleteTaskDraft',
        id: writer.latest.id,
        revision: writer.latest.revision,
        requestId: crypto.randomUUID(),
      });
    else flush(writer);
  }
  inform();
});
export function useTaskDraft(
  data: Omit<TaskDraft, 'id' | 'revision' | 'updatedAt'>,
  dispatch: (message: ClientMessage) => void,
) {
  const [, refresh] = useState(0);
  const identity = useRef({
    id: savedTaskDraft()?.id ?? crypto.randomUUID(),
    revision: savedTaskDraft()?.revision ?? 0,
  });
  const writer = useRef<Writer | undefined>(undefined);
  if (!writer.current) {
    writer.current = writers.get(identity.current.id) ?? {
      latest: { ...data, ...identity.current, updatedAt: new Date().toISOString() },
      dispatch,
    };
    writers.set(identity.current.id, writer.current);
  }
  const current = writer.current;
  const selected = savedTaskDraft();
  if (
    selected?.id === current.latest.id &&
    selected.revision > current.latest.revision &&
    !current.sent
  ) {
    current.latest = selected;
    current.error = undefined;
    current.written = payload(selected);
  }
  useEffect(() => {
    const listener = () => refresh((n) => n + 1);
    listeners.add(listener);
    if (isHosted) dispatch({ type: 'listTaskDrafts' });
    return () => {
      listeners.delete(listener);
      flush(current);
    };
  }, []);
  const content = JSON.stringify(data);
  useEffect(() => {
    if (current.finished) return;
    current.latest = { ...current.latest, ...data, updatedAt: new Date().toISOString() };
    persistView({ taskDraft: current.latest });
    clearTimeout(current.timer);
    current.timer = setTimeout(() => flush(current), 500);
    // The writer survives modal closure so saves and acknowledgements cannot be lost.
  }, [content]);
  return {
    drafts: savedTaskDrafts(),
    saving: Boolean(current.sent),
    saved: Boolean(current.latest.revision),
    error: current.error,
    status:
      current.error ??
      (current.sent
        ? 'Enregistrement du brouillon…'
        : current.written === payload(current.latest)
          ? 'Brouillon enregistré'
          : 'Brouillon conservé dans cette fenêtre'),
    finish: () => {
      current.finished = true;
      clearTimeout(current.timer);
      persistView({ taskDraft: undefined });
      if (!current.sent && current.latest.revision)
        dispatch({
          type: 'deleteTaskDraft',
          id: current.latest.id,
          revision: current.latest.revision,
          requestId: crypto.randomUUID(),
        });
    },
    retry: () => {
      current.error = undefined;
      flush(current);
      inform();
    },
  };
}
