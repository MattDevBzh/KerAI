import { useEffect, useMemo, useState } from 'react';
import { proofDossier, type ProofClaim, type ProofEntry } from '../src/shared/proofs';
import type { Attempt, ClientMessage, Feature, FeatureStep } from '../src/shared/types';
import { ImageGallery } from './Images';
import { subscribe } from './bridge';
import './proofs.css';
const kinds: Record<ProofEntry['kind'], string> = {
  image: 'Capture',
  test: 'Test',
  file: 'Code consulté',
  web: 'Source web',
  context: 'Contexte chargé',
  activity: 'Action observée',
  report: 'Livrable',
  approval: 'Validation',
};
const states: Record<ProofEntry['state'], string> = {
  observed: 'Observation conservée',
  failed: 'Échec observé',
  pending: 'En attente',
  recheck: 'À revérifier',
};
const verdicts: Record<ProofClaim['verdict'], string> = {
  supported: 'Confirmé',
  contradicted: 'Contredit',
  unverified: 'Non vérifié',
};
export function ProofDossierPanel({
  feature,
  step,
  attempt,
  disabled,
  dispatch,
}: {
  feature: Feature;
  step: FeatureStep;
  attempt?: Attempt;
  disabled: boolean;
  dispatch: (message: ClientMessage) => void;
}) {
  const dossier = useMemo(() => proofDossier(feature), [feature]);
  const [filter, setFilter] = useState(''),
    [kind, setKind] = useState('all'),
    [pending, setPending] = useState<string>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [text, setText] = useState(''),
    [proofIds, setProofIds] = useState<string[]>([]),
    [verdict, setVerdict] = useState<ProofClaim['verdict']>('unverified'),
    [claimId, setClaimId] = useState<string>();
  const [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<string>();
  const editable =
    !disabled &&
    attempt?.id === step.attempts.at(-1)?.id &&
    ['awaiting_review', 'waiting_input'].includes(step.status);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'proofDossierResult' && message.requestId === pending) {
          setPending(undefined);
          setError(message.error ?? '');
          setNotice(message.notice ?? '');
          if (!message.error) {
            setEditing(false);
            setText('');
            setProofIds([]);
            setClaimId(undefined);
          }
        }
      }),
    [pending],
  );
  const request = (type: 'checkProofDossier' | 'exportProofDossier') => {
    const requestId = crypto.randomUUID();
    setPending(requestId);
    setError('');
    dispatch({ type, featureId: feature.id, requestId });
  };
  const sources = dossier.sources.filter(
    (s) =>
      (kind === 'all' || s.kind === kind) &&
      `${s.title} ${s.content} ${s.id}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const open = (id: string) => {
    setKind('all');
    setFilter('');
    setSelected(id);
    requestAnimationFrame(() =>
      document
        .getElementById(`proof-${id}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  };
  return (
    <section className="proof-dossier" aria-label="Dossier de preuves">
      <header>
        <div>
          <span className="eyebrow">TOUTE LA SESSION</span>
          <h3>Dossier de preuves</h3>
          <p>
            Les observations, les conclusions et les validations restent distinctes. Une source
            conservée n’est pas une garantie que le code ou le site n’a pas changé.
          </p>
        </div>
        <div className="proof-actions">
          <button
            className="button secondary"
            disabled={disabled || Boolean(pending)}
            onClick={() => request('checkProofDossier')}
          >
            Vérifier les empreintes
          </button>
          <button
            className="button secondary"
            disabled={Boolean(pending)}
            onClick={() => request('exportProofDossier')}
          >
            Exporter le dossier
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="proof-metrics">
        <span>
          <strong>{dossier.sources.length}</strong> sources
        </span>
        <span>
          <strong>{dossier.claims.filter((c) => !c.stale).length}</strong> conclusions actuelles
        </span>
        <span>
          <strong>{dossier.sources.filter((s) => s.state === 'recheck').length}</strong> sources à
          revérifier
        </span>
      </div>
      <h4>Conclusions et justificatifs</h4>
      {!dossier.claims.length && (
        <p>
          Aucune conclusion reliée pour le moment. L’agent peut en proposer pendant son travail ; tu
          peux aussi en ajouter après son intervention.
        </p>
      )}
      {dossier.claims.map((claim) => (
        <article className={`proof-claim ${claim.stale ? 'stale' : ''}`} key={claim.id}>
          <strong>{claim.text}</strong>
          <p>
            {claim.stale ? 'À revérifier' : verdicts[claim.verdict]} ·{' '}
            {claim.author === 'human' ? 'Appréciation humaine' : 'Appréciation de l’agent'} ·
            livrable v{claim.reportRevision + 1} · {new Date(claim.at).toLocaleString('fr-FR')}
          </p>
          <div className="proof-links">
            {claim.proofIds.map((id) => (
              <button
                type="button"
                className="text-button"
                key={id}
                onClick={() => open(id)}
                disabled={claim.missingIds.includes(id)}
              >
                {dossier.sources.find((s) => s.id === id)?.title ?? 'Source absente'}
              </button>
            ))}
          </div>
          {!claim.proofIds.length && <small>Aucun justificatif associé.</small>}
          {editable && claim.attemptId === attempt?.id && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setEditing(true);
                setClaimId(claim.id);
                setText(claim.text);
                setProofIds(claim.proofIds.filter((id) => !claim.missingIds.includes(id)));
                setVerdict(claim.verdict);
              }}
            >
              Réviser cette conclusion
            </button>
          )}
        </article>
      ))}
      {editable && !editing && (
        <button
          className="button secondary"
          onClick={() => {
            setEditing(true);
            setClaimId(undefined);
            setText('');
            setProofIds([]);
            setVerdict('unverified');
          }}
        >
          Ajouter une conclusion
        </button>
      )}
      {editing && editable && (
        <form
          className="proof-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (!attempt || pending) return;
            const requestId = crypto.randomUUID();
            setPending(requestId);
            setError('');
            dispatch({
              type: 'saveProofClaim',
              featureId: feature.id,
              stepId: step.id,
              attemptId: attempt.id,
              revision: attempt.revision ?? 0,
              requestId,
              claimId,
              claim: { text, proofIds, verdict },
            });
          }}
        >
          <label className="field">
            <span>Conclusion</span>
            <textarea
              aria-label="Conclusion"
              required
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Ton appréciation</span>
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value as ProofClaim['verdict'])}
            >
              {Object.entries(verdicts).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Justificatifs conservés</legend>
            <div className="proof-choices">
              {dossier.sources.map((source) => (
                <label key={source.id}>
                  <input
                    type="checkbox"
                    checked={proofIds.includes(source.id)}
                    onChange={(e) =>
                      setProofIds((ids) =>
                        e.target.checked
                          ? [...ids, source.id]
                          : ids.filter((id) => id !== source.id),
                      )
                    }
                  />
                  <span>
                    {kinds[source.kind]} · {source.title} <small>{states[source.state]}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p>
            Enregistrer cette conclusion ne valide pas l’étape. Une révision conserve la conclusion
            précédente dans l’historique.
          </p>
          <div className="proof-actions">
            <button className="button primary" disabled={Boolean(pending) || !text.trim()}>
              Conserver la conclusion
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={Boolean(pending)}
              onClick={() => setEditing(false)}
            >
              Annuler
            </button>
          </div>
        </form>
      )}
      <h4>Sources conservées</h4>
      <div className="proof-filters">
        <input
          aria-label="Rechercher dans les preuves"
          placeholder="Fichier, capture, test, source…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select aria-label="Type de preuve" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">Tous les types</option>
          {Object.entries(kinds).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {!sources.length && <p>Aucune preuve correspondant à ce filtre.</p>}
      {sources.map((source) => (
        <details
          id={`proof-${source.id}`}
          key={source.id}
          className="proof-source"
          open={selected === source.id}
          onToggle={(e) => {
            if (!e.currentTarget.open && selected === source.id) setSelected(undefined);
          }}
        >
          <summary
            onClick={(e) => {
              e.preventDefault();
              setSelected(selected === source.id ? undefined : source.id);
            }}
          >
            <span>
              {kinds[source.kind]} · {source.title}
            </span>
            <small>
              {states[source.state]} ·{' '}
              {source.origin === 'human'
                ? 'Humain'
                : source.origin === 'runtime'
                  ? 'Observé par KerAI'
                  : 'Texte de l’agent'}
            </small>
          </summary>
          <p>
            {source.at}
            {source.reportRevision !== undefined ? ` · livrable v${source.reportRevision + 1}` : ''}
          </p>
          {source.reason && <p className="proof-caution">{source.reason}</p>}
          {source.image && <ImageGallery images={[source.image]} />}
          {source.url && (
            <a href={source.url} target="_blank" rel="noreferrer">
              Ouvrir la source web
            </a>
          )}
          {source.attachmentId && source.evidenceId && (
            <button
              className="text-button"
              onClick={() =>
                dispatch({
                  type: 'openQualityAttachment',
                  featureId: feature.id,
                  evidenceId: source.evidenceId!,
                  attachmentId: source.attachmentId!,
                })
              }
            >
              Ouvrir la pièce de test
            </button>
          )}
          <pre>{source.content}</pre>
          {source.digest && <code>SHA-256 : {source.digest}</code>}
          <small className="proof-id">{source.id}</small>
        </details>
      ))}
    </section>
  );
}
