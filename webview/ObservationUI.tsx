import { useEffect, useRef, useState } from 'react';
import { Eye, FileDown, LoaderCircle, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import type {
  ClientMessage,
  Feature,
  ObservationAnalysis,
  ObservationPreview,
  SessionObservation,
  SessionStorageInfo,
  StudioState,
} from '../src/shared/types';
import { DEFAULT_TRACE_BYTES } from '../src/shared/observation';
import {
  featureUsage,
  observerUsage,
  observationModels,
  sumUsage,
} from '../src/shared/observationReport';
import { usageCredits, toNanoAiu } from '../src/shared/credits';
import { subscribe } from './bridge';
import { featureStateKey } from '../src/shared/collaboration';
import './observation.css';

const credits = (usage: ReturnType<typeof sumUsage>) =>
  usage ? usageCredits(usage) : 'Crédits non communiqués';
const bytes = (size: number) =>
  `${(size / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio`;
const date = (value: string) =>
  Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('fr-FR') : value;
const seconds = (ms: number) => `${Math.round(ms / 1000).toLocaleString('fr-FR')} s`;
const status = {
  running: 'Analyse en cours',
  completed: 'Analyse terminée',
  failed: 'Analyse incomplète',
  cancelled: 'Analyse annulée',
  interrupted: 'Analyse interrompue',
};
const kinds = {
  fact: 'Fait observé',
  interpretation: 'Interprétation',
  recommendation: 'Amélioration',
};
const impacts = { high: 'Prioritaire', medium: 'Utile', low: 'À envisager' };

function Analysis({
  analysis,
  source,
}: {
  analysis: ObservationAnalysis;
  source: (id: string) => void;
}) {
  return (
    <div className="observation-analysis">
      <p className="observation-summary">{analysis.summary}</p>
      {analysis.strengths.length > 0 && (
        <div className="observation-strengths">
          <h4>Ce qui a bien fonctionné</h4>
          <ul>
            {analysis.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {analysis.findings.map((finding, i) => (
        <article className={`observation-finding ${finding.kind}`} key={i}>
          <div className="observation-finding-tags">
            <span>{kinds[finding.kind]}</span>
            <span>{impacts[finding.impact]}</span>
          </div>
          <h4>{finding.title}</h4>
          <p>{finding.detail}</p>
          <div className="observation-references">
            {finding.references.map((id, n) => (
              <button className="text-button" key={id} onClick={() => source(id)}>
                Voir la preuve {n + 1}
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
export function ObservationPanel({
  feature,
  state,
  dispatch,
  close,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
  close: () => void;
}) {
  const preferred =
    state.agents.find((a) => a.id === 'fs-observer')?.model ||
    state.settings.modelProfiles?.balanced?.model ||
    state.settings.defaultModel;
  const [model, setModel] = useState(
    state.runtime.models.find((m) => m.id === preferred)?.id || state.runtime.models[0]?.id || '',
  );
  const [maxCalls, setMaxCalls] = useState(40),
    [maxCredits, setMaxCredits] = useState('');
  const [preview, setPreview] = useState<ObservationPreview>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [storage, setStorage] = useState<SessionStorageInfo>();
  const [source, setSource] = useState<{ label: string; content: string }>();
  const [sourceError, setSourceError] = useState('');
  const proofPanel = useRef<HTMLElement>(null);
  const proofOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (source) proofPanel.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [source]);
  const previewRequest = useRef(''),
    sourceRequest = useRef('');
  const storageRequest = useRef(`storage-${feature.id}-${Date.now()}`);
  const reviews = feature.observations ?? [];
  const review = reviews.find((r) => r.id === selected) ?? reviews.at(-1);
  const running = reviews.some((r) => r.status === 'running');
  const busy =
    Boolean(state.workspaceOperation) ||
    state.features.some(
      (f) => f.steps.some((s) => s.status === 'running') || f.autopilot?.status === 'running',
    );
  const options = {
    model,
    maxCalls,
    ...(maxCredits !== '' && Number(maxCredits) > 0
      ? { maxNanoAiu: toNanoAiu(Number(maxCredits)) }
      : {}),
  };
  const valid =
    model && maxCalls >= 2 && maxCalls <= 10000 && (maxCredits === '' || Number(maxCredits) > 0);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === 'observationPreview' && message.requestId === previewRequest.current) {
        setPending(false);
        setError(message.error ?? '');
        setPreview(message.preview);
      }
      if (message.type === 'sessionStorage' && message.requestId === storageRequest.current) {
        setStorage(message.storage);
        if (message.error) setError(message.error);
      }
      if (message.type === 'observationSource' && message.requestId === sourceRequest.current) {
        setSourceError(message.error ?? '');
        if (message.content !== undefined)
          setSource({ label: message.label ?? 'Source', content: message.content });
      }
    });
    dispatch({ type: 'sessionStorage', featureId: feature.id, requestId: storageRequest.current });
    return unsubscribe;
  }, [feature.id]);
  const reset = () => {
    setPreview(undefined);
    setError('');
  };
  const showSource = (id: string) => {
    if (!review) return;
    proofOrigin.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSource(undefined);
    setSourceError('Chargement de la preuve…');
    sourceRequest.current = `source-${Date.now()}`;
    dispatch({
      type: 'observationSource',
      featureId: feature.id,
      observationId: review.id,
      sourceId: id,
      requestId: sourceRequest.current,
    });
  };
  return (
    <section className="observation-workspace" aria-label="Observateur de session">
      <header className="observation-heading">
        <div>
          <span className="eyebrow">UN REGARD SUR VOTRE PARCOURS</span>
          <h2>
            <Eye size={24} /> Observateur de session
          </h2>
          <p>
            Relisez toute cette feature, phase par phase, et identifiez les améliorations utiles.
          </p>
        </div>
        <button className="icon-button" aria-label="Fermer l’Observateur" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="observation-launch">
        <label>
          Modèle de l’Observateur
          <select
            value={model}
            disabled={busy || pending}
            onChange={(e) => {
              setModel(e.target.value);
              reset();
            }}
          >
            <option value="">Choisir un modèle</option>
            {state.runtime.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Maximum d’appels
          <input
            type="number"
            min={2}
            max={10000}
            value={maxCalls}
            disabled={busy || pending}
            onChange={(e) => {
              setMaxCalls(Number(e.target.value));
              reset();
            }}
          />
        </label>
        <label>
          Budget en crédits (facultatif)
          <input
            type="number"
            min={0.000001}
            step="any"
            placeholder="Sans plafond de crédits"
            value={maxCredits}
            disabled={busy || pending}
            onChange={(e) => {
              setMaxCredits(e.target.value);
              reset();
            }}
          />
        </label>
        <button
          className="button secondary"
          disabled={!valid || busy || pending}
          onClick={() => {
            previewRequest.current = `preview-${Date.now()}`;
            setPending(true);
            setError('');
            dispatch({
              type: 'previewObservation',
              featureId: feature.id,
              requestId: previewRequest.current,
              options,
            });
          }}
        >
          {pending ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{' '}
          Préparer l’analyse
        </button>
      </div>
      <p className="observation-help">
        La préparation est locale et ne consomme aucun crédit. L’analyse lit une copie figée de
        cette session. Son coût réel sera ajouté au rapport ; un plafond de crédits est vérifié
        entre les appels.
      </p>
      {state.runtime.state !== 'ready' && (
        <p className="inline-error">
          Vérifiez la connexion Copilot dans les réglages avant le lancement.
        </p>
      )}
      {preview && (
        <div className="observation-preview">
          <strong>
            {preview.phases} phases · au moins {preview.parts} appels ·{' '}
            {preview.characters.toLocaleString('fr-FR')} caractères à examiner
          </strong>
          {preview.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          {preview.parts > maxCalls && (
            <p className="inline-error">
              Augmentez le maximum d’appels à {preview.parts} ou plus, puis préparez un nouvel
              aperçu.
            </p>
          )}
          <button
            className="button primary"
            disabled={busy || preview.parts > maxCalls || state.runtime.state !== 'ready'}
            onClick={() => {
              setSelected('');
              setSource(undefined);
              dispatch({
                type: 'runObservation',
                featureId: feature.id,
                options,
                fingerprint: preview.fingerprint,
              });
              setPreview(undefined);
            }}
          >
            <Eye size={16} /> Lancer l’Observateur
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {storage && (
        <div className="observation-storage">
          <span>
            Stockage propre : <strong>{bytes(storage.bytes)}</strong> · objets associés ou partagés
            : {bytes(storage.sharedBytes)}
          </span>
          <span>
            Traces : {bytes(storage.traces.bytes)} / {bytes(storage.traceLimitBytes)} ·{' '}
            {storage.traces.records.toLocaleString('fr-FR')} événements
          </span>
          {storage.traces.reason && <p className="inline-error">{storage.traces.reason}</p>}
          {storage.traces.bytes >= storage.traceLimitBytes * 0.8 && (
            <strong className="inline-error">
              Les traces approchent de leur limite. Augmentez-la dans les réglages ou supprimez les
              sessions inutiles.
            </strong>
          )}
        </div>
      )}
      <div className="observation-toolbar">
        {reviews.length > 0 && (
          <label>
            Rapports de cette session
            <select
              value={review?.id ?? ''}
              onChange={(e) => {
                setSelected(e.target.value);
                setSource(undefined);
              }}
            >
              {[...reviews].reverse().map((r) => (
                <option key={r.id} value={r.id}>
                  {date(r.createdAt)} · {status[r.status]}
                </option>
              ))}
            </select>
          </label>
        )}
        {running && (
          <button
            className="button secondary"
            onClick={() => dispatch({ type: 'cancelObservation', featureId: feature.id })}
          >
            <Square size={14} /> Arrêter l’analyse
          </button>
        )}
        {review && (
          <>
            <button
              className="button secondary small"
              onClick={() =>
                dispatch({
                  type: 'exportObservation',
                  featureId: feature.id,
                  observationId: review.id,
                  format: 'html',
                })
              }
            >
              <FileDown size={15} /> Exporter en HTML
            </button>
            <button
              className="button secondary small"
              onClick={() =>
                dispatch({
                  type: 'exportObservation',
                  featureId: feature.id,
                  observationId: review.id,
                  format: 'markdown',
                })
              }
            >
              Markdown
            </button>
          </>
        )}
        <button
          className="button secondary small observation-delete"
          disabled={busy || pending}
          onClick={() => dispatch({ type: 'deleteFeature', featureId: feature.id })}
        >
          <Trash2 size={15} /> Supprimer définitivement la session
        </button>
      </div>
      {review ? (
        <ObservationReport feature={feature} review={review} source={showSource} />
      ) : (
        <div className="observation-empty">
          <Eye size={38} />
          <h3>Votre prochaine amélioration commence ici.</h3>
          <p>
            L’Observateur examinera les échanges, les outils, les livrables et les validations de
            chaque phase. Ses conseils renverront aux preuves de cette session.
          </p>
        </div>
      )}
      {(source || sourceError) && (
        <aside
          ref={proofPanel}
          className="observation-source"
          role="region"
          aria-label="Preuve de l’analyse"
        >
          <button
            className="icon-button"
            aria-label="Fermer la preuve"
            onClick={() => {
              setSource(undefined);
              setSourceError('');
              proofOrigin.current?.focus();
            }}
          >
            <X size={16} />
          </button>
          <h3>{source?.label ?? 'Preuve'}</h3>
          {sourceError && <p>{sourceError}</p>}
          {source && <pre>{source.content}</pre>}
        </aside>
      )}
    </section>
  );
}
function ObservationReport({
  feature,
  review,
  source,
}: {
  feature: Feature;
  review: SessionObservation;
  source: (id: string) => void;
}) {
  const work = sumUsage(review.phases.map((p) => p.usage));
  const currentReview = observerUsage(review),
    allReviews = sumUsage((feature.observations ?? []).flatMap((r) => r.calls.map((c) => c.usage)));
  const total = sumUsage([featureUsage(feature), allReviews]);
  const effectiveModels = observationModels(review);
  return (
    <div className="observation-report">
      <header className="observation-report-cover">
        <span className="eyebrow">COMPTE RENDU DE SESSION</span>
        <h2>{review.featureTitle}</h2>
        <p>
          {date(review.createdAt)} · {status[review.status]}
        </p>
        <div className="observation-coverage">
          {review.status === 'running' && <LoaderCircle className="spin" size={16} />}
          {review.coverage.analyzedParts} / {review.coverage.totalParts} parties examinées ·{' '}
          {review.coverage.complete ? 'Traces complètes' : 'Couverture partielle'}
        </div>
      </header>
      {review.snapshotStateKey && review.snapshotStateKey !== featureStateKey(feature) && (
        <p className="observation-warning">
          Cette session a évolué depuis la revue. Ce rapport décrit l’état enregistré lors de son
          lancement.
        </p>
      )}
      {review.coverage.warnings.map((w, i) => (
        <p className="observation-warning" key={i}>
          {w}
        </p>
      ))}
      {review.error && <p className="observation-warning">{review.error}</p>}
      <div className="observation-cost-cards">
        <div>
          <span>Travail analysé</span>
          <strong>{credits(work)}</strong>
        </div>
        <div>
          <span>Cette revue</span>
          <strong>{credits(currentReview)}</strong>
        </div>
        <div>
          <span>Toutes les revues</span>
          <strong>{credits(allReviews)}</strong>
        </div>
        <div>
          <span>Total actuel de la session</span>
          <strong>{credits(total)}</strong>
        </div>
      </div>
      <nav className="observation-toc" aria-label="Phases du rapport">
        {review.phases.map((p, i) => (
          <a key={p.stepId} href={`#observation-${review.id}-${i}`}>
            {i + 1}. {p.name}
          </a>
        ))}
        <a href={`#observation-${review.id}-global`}>Commentaires globaux</a>
        <a href={`#observation-${review.id}-self`}>Bilan de l’Observateur</a>
      </nav>
      <div className="observation-table-wrap">
        <table className="observation-table">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Agent / modèles</th>
              <th>Tentatives</th>
              <th>Durée</th>
              <th>Consommation</th>
            </tr>
          </thead>
          <tbody>
            {review.phases.map((p) => (
              <tr key={p.stepId}>
                <td>{p.name}</td>
                <td>
                  {p.agent}
                  <small>{p.models.join(', ') || 'Non communiqués'}</small>
                </td>
                <td>{p.attempts}</td>
                <td>{seconds(p.durationMs)}</td>
                <td>{credits(p.usage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {review.phases.map((phase, i) => (
        <section
          className="observation-phase"
          id={`observation-${review.id}-${i}`}
          key={phase.stepId}
        >
          <header>
            <span className="observation-phase-number">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{phase.name}</h3>
              <p>
                {phase.agent} · {phase.models.join(', ') || 'Modèles non communiqués'} ·{' '}
                {credits(phase.usage)}
              </p>
              <small>
                {phase.attempts} tentative(s) · {seconds(phase.durationMs)} · {phase.analyzedParts}/
                {phase.totalParts} parties analysées
              </small>
            </div>
          </header>
          {phase.usage?.byModel && (
            <details>
              <summary>Consommation par modèle</summary>
              <ul>
                {Object.entries(phase.usage.byModel).map(([name, metric]) => (
                  <li key={name}>
                    {name} · {usageCredits({ source: 'measured', unit: 'nano-AIU', ...metric })} ·
                    tokens entrée {metric.inputTokens ?? '?'} / sortie {metric.outputTokens ?? '?'}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {phase.analyses.map((analysis, n) => (
            <Analysis key={n} analysis={analysis} source={source} />
          ))}
          {phase.analyzedParts < phase.totalParts && (
            <p className="observation-warning">
              Cette phase n’a pas encore été entièrement examinée.
            </p>
          )}
        </section>
      ))}
      <section className="observation-phase" id={`observation-${review.id}-global`}>
        <h3>Commentaires globaux et améliorations prioritaires</h3>
        {review.global ? (
          <Analysis analysis={review.global} source={source} />
        ) : (
          <p>La synthèse sera disponible après l’analyse de toutes les phases.</p>
        )}
      </section>
      <section className="observation-self" id={`observation-${review.id}-self`}>
        <h3>
          <ShieldCheck size={21} /> Bilan de l’Observateur
        </h3>
        <p>Modèle demandé : {review.requestedModel}</p>
        <p>
          Modèle(s) effectivement observé(s) :{' '}
          <strong>{effectiveModels.join(', ') || 'Aucun appel'}</strong>
        </p>
        <div className="observation-cost-cards">
          <div>
            <span>Consommation mesurée</span>
            <strong>{credits(currentReview)}</strong>
          </div>
          <div>
            <span>Appels</span>
            <strong>
              {review.calls.length} / {review.maxCalls}
            </strong>
          </div>
          <div>
            <span>Tokens entrée / sortie</span>
            <strong>
              {currentReview?.inputTokens ?? '?'} / {currentReview?.outputTokens ?? '?'}
            </strong>
          </div>
          <div>
            <span>Durée de la revue</span>
            <strong>
              {review.finishedAt
                ? seconds(Math.max(0, Date.parse(review.finishedAt) - Date.parse(review.createdAt)))
                : 'En cours'}
            </strong>
          </div>
        </div>
        <details>
          <summary>Détail des appels et mesures</summary>
          <ul>
            {review.calls.map((call) => (
              <li key={call.id}>
                {call.phaseId
                  ? review.phases.find((p) => p.stepId === call.phaseId)?.name
                  : 'Synthèse'}{' '}
                · {call.model || 'Modèle non communiqué'} · {credits(call.usage)} · {call.status}
                {call.error && ` · ${call.error}`}
              </li>
            ))}
          </ul>
        </details>
        <p className="observation-help">
          Les crédits et modèles proviennent des mesures reçues par KerAI. Une mesure manquante
          reste inconnue. Les appels interrompus et échoués restent inclus.
        </p>
      </section>
    </div>
  );
}
export function TraceStorageSetting({
  value,
  onChange,
}: {
  value?: number;
  onChange: (bytes: number) => void;
}) {
  return (
    <section className="settings-card">
      <h2>Archives de session</h2>
      <p>
        Les échanges complets restent sur disque. L’activité affichée utilise un aperçu et un
        journal paginé.
      </p>
      <label>
        Limite des traces par session (Mio)
        <input
          type="number"
          min={1}
          max={4096}
          value={(value ?? DEFAULT_TRACE_BYTES) / 1024 ** 2}
          onChange={(e) => onChange(Number(e.target.value) * 1024 ** 2)}
        />
      </label>
      <p>
        Valeur initiale : 256 Mio. Les pièces jointes et points de restauration sont comptés
        séparément. L’Observateur permet de consulter l’espace utilisé et de supprimer une session
        entière.
      </p>
    </section>
  );
}
export function TraceJournal({
  featureId,
  attemptId,
  dispatch,
}: {
  featureId: string;
  attemptId: string;
  dispatch: (message: ClientMessage) => void;
}) {
  const [page, setPage] = useState<import('../src/shared/observation').SessionTrace[]>(),
    [next, setNext] = useState<number>(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const request = useRef('');
  useEffect(() => {
    setPage(undefined);
    setNext(undefined);
    setError('');
    setPending(false);
    return subscribe((message) => {
      if (message.type === 'sessionJournal' && message.requestId === request.current) {
        setPending(false);
        setError(message.error ?? '');
        setPage(message.traces);
        setNext(message.nextOffset);
      }
    });
  }, [attemptId]);
  const load = (offset = 0) => {
    request.current = `journal-${Date.now()}`;
    setPending(true);
    dispatch({ type: 'sessionJournal', featureId, attemptId, requestId: request.current, offset });
  };
  return (
    <div className="trace-archive-page">
      <p>
        Les traces complètes sont conservées sur disque. L’activité ci-dessous affiche les
        événements récents.
      </p>
      <button className="button secondary small" disabled={pending} onClick={() => load()}>
        {pending ? 'Chargement…' : 'Consulter le journal complet'}
      </button>
      {error && <p className="inline-error">{error}</p>}
      {page && (
        <>
          <p>{page.length} événement(s) dans cette page.</p>
          {page.map((trace) => (
            <details key={trace.id}>
              <summary>
                {date(trace.at)} · {trace.type}
                {trace.agentId ? ` · ${trace.agentId}` : ''}
              </summary>
              <pre>{trace.data}</pre>
            </details>
          ))}
          {next !== undefined && (
            <button
              className="button secondary small"
              disabled={pending}
              onClick={() => load(next)}
            >
              Page suivante
            </button>
          )}
        </>
      )}
    </div>
  );
}
