import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, CirclePause, Play } from 'lucide-react';
import { hqBoard } from '../src/shared/hqCinema';
import type { FeatureStep } from '../src/shared/types';

const labels = { pending: 'À faire', in_progress: 'En cours', done: 'Fait', blocked: 'Bloqué' };

/** The board shows agent declarations. It never approves work or advances the workflow. */
export function HqTaskBoard({ step, name }: { step?: FeatureStep; name: string }) {
  const board = hqBoard(step);
  const [shortScreen, setShortScreen] = useState(() => matchMedia('(max-height: 820px)').matches);
  useEffect(() => {
    const query = matchMedia('(max-height: 820px)');
    const update = () => setShortScreen(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const initial = new Map(board.initialPlan.map((i) => [i.id, i.text]));
  // Give long notes their own page instead of shrinking the handwriting or clipping it.
  const groups: (typeof board.items)[] = [[]];
  let lines = 0;
  for (const item of board.items) {
    const cost =
      Math.ceil(Math.max(item.text.length, initial.get(item.id)?.length ?? 0) / 55) +
      Math.ceil((item.note?.length ?? 0) / 80) * 0.75 +
      0.4;
    if (
      groups.at(-1)!.length &&
      (groups.at(-1)!.length === 4 || lines + cost > (shortScreen ? 5 : 7))
    ) {
      groups.push([]);
      lines = 0;
    }
    groups.at(-1)!.push(item);
    lines += cost;
  }
  const pages = groups.length;
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [original, setOriginal] = useState(false);
  const current = board.items.findIndex(
    (i) => i.status === 'in_progress' || i.status === 'blocked',
  );
  const focusPage = Math.max(
    0,
    groups.findIndex((group) => group.some((i) => i.id === board.items[current]?.id)),
  );
  const identity = `${step?.id}:${step?.attempts.at(-1)?.id}`;
  useEffect(() => {
    setPage(focusPage);
  }, [identity, current, focusPage]);
  useEffect(() => {
    setOriginal(false);
    setPaused(false);
  }, [identity]);
  useEffect(() => {
    if (pages < 2 || paused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setPage((value) => (value + 1) % pages);
    }, 14000);
    return () => clearInterval(timer);
  }, [pages, paused, identity]);
  const selected = Math.min(page, pages - 1);
  const changed = board.items.filter(
    (i) => initial.has(i.id) && initial.get(i.id) !== i.text,
  ).length;
  const added = board.initialPlan.length ? board.items.filter((i) => !initial.has(i.id)).length : 0;
  const done = board.items.filter((i) => i.status === 'done').length;
  return (
    <section className="hq-task-board" aria-label={`Tableau de ${name}`}>
      <header className="hq-board-heading">
        <span className="hq-board-owner">Le carnet de {name}</span>
        <h3>{board.title}</h3>
        <span className="hq-board-count">
          {done} / {board.items.length} faites
        </span>
      </header>
      <ol
        className="hq-board-list"
        start={groups.slice(0, selected).reduce((count, group) => count + group.length, 0) + 1}
        aria-label="Liste de suivi"
      >
        {groups[selected].map((item) => (
          <li key={item.id} data-status={item.status}>
            <span className="hq-board-check" aria-label={labels[item.status]}>
              {item.status === 'done'
                ? '✓'
                : item.status === 'blocked'
                  ? '!'
                  : item.status === 'in_progress'
                    ? '›'
                    : ''}
            </span>
            <div>
              <span className="hq-board-line">
                {original ? (initial.get(item.id) ?? item.text) : item.text}
              </span>
              {item.status === 'in_progress' && <small className="hq-board-now">en cours</small>}
              {item.status === 'blocked' && <small className="hq-board-now">bloqué</small>}
              {!original && item.note && <small className="hq-board-note">{item.note}</small>}
              {initial.has(item.id) && initial.get(item.id) !== item.text && (
                <small className="hq-board-change">
                  {original ? 'Texte du plan initial' : 'Ligne ajustée depuis le plan initial'}
                </small>
              )}
              {!!initial.size && !initial.has(item.id) && (
                <small className="hq-board-change">Ajout au plan</small>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!board.items.length && (
        <p className="hq-board-empty">Le tableau attend la première mission.</p>
      )}
      <footer className="hq-board-footer">
        <span>
          {board.source === 'agent'
            ? 'Suivi déclaré par l’agent'
            : board.source === 'plan'
              ? 'D’après le plan de travail'
              : 'Mission confiée'}{' '}
          · validation dans le cockpit
        </span>
        {(changed > 0 || added > 0) && (
          <button type="button" onClick={() => setOriginal((v) => !v)} aria-pressed={original}>
            {original ? 'Voir le texte actuel' : 'Relire le plan initial'} · {changed} ajustée
            {changed > 1 ? 's' : ''}, {added} ajoutée{added > 1 ? 's' : ''}
          </button>
        )}
        <div className="hq-board-pagination">
          <span>
            {board.updatedAt
              ? `Actualisé à ${new Date(board.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : 'En attente des notes de l’agent'}
          </span>
          {pages > 1 && (
            <div>
              <button
                type="button"
                aria-label="Page précédente du tableau"
                onClick={() => setPage((selected + pages - 1) % pages)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                Page {selected + 1} / {pages}
              </span>
              <button
                type="button"
                aria-label="Page suivante du tableau"
                onClick={() => setPage((selected + 1) % pages)}
              >
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                aria-label={
                  paused ? 'Reprendre les pages du tableau' : 'Suspendre les pages du tableau'
                }
                onClick={() => setPaused((v) => !v)}
              >
                {paused ? <Play size={16} /> : <CirclePause size={16} />}
              </button>
            </div>
          )}
        </div>
      </footer>
      <span className="hq-board-chalk" aria-hidden="true" />
    </section>
  );
}
