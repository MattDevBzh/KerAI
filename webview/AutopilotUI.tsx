import { useState, useEffect, useRef } from 'react';
import {
  Check,
  Flag,
  Gauge,
  Pause,
  Play,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
} from 'lucide-react';
import type {
  AutopilotConfig,
  Feature,
  FeatureStep,
  StudioState,
  RunLaunchOptions,
} from '../src/shared/types';
import type { AutopilotPreview } from '../src/shared/evolutions';
import { stepResolved } from '../src/shared/optionalSteps';
import { allFeatures } from '../src/shared/subplans';
import { needsDevOpsEvidence } from '../src/shared/devopsKit';
import { subscribe } from './bridge';
import { HumanRequests, McpPicker, MemoryPicker, StudioDialog, type Dispatch } from './ExecutionUI';
import { NavigationLaunchPicker } from './ApplicationsUI';

const blankLaunch = (step: FeatureStep, feature: Feature): RunLaunchOptions => ({
  initialContext: step.initialContext ?? '',
  mcpServerIds: step.mcpServerIds ?? [],
  memoryIds: [],
  useProjectMemory: false,
  ...(feature.navigation ? { navigation: feature.navigation } : {}),
});
const balancedCheckpoints = (feature: Feature) =>
  feature.steps
    .filter(
      (step) =>
        step.id === 'plan' ||
        step.id === 'review' ||
        step.agentId.includes('plan') ||
        step.agentId.includes('review'),
    )
    .map((step) => step.id);
export function AutopilotBar({
  feature,
  state,
  dispatch,
  selectStep,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: Dispatch;
  selectStep?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [starting, setStarting] = useState(false);
  const auto = feature.autopilot;
  const [preview, setPreview] = useState<AutopilotPreview>();
  const [previewError, setPreviewError] = useState('');
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    if (!starting) return;
    const requestId = crypto.randomUUID();
    setPreview(undefined);
    setPreviewError('');
    const stop = subscribe((message) => {
      if (message.type !== 'autopilotPreview' || message.requestId !== requestId) return;
      setPreview(message.preview);
      setPreviewError(message.error ?? '');
    });
    dispatchRef.current({ type: 'previewAutopilot', featureId: feature.id, requestId });
    return stop;
  }, [starting, feature.id]);
  const active = allFeatures(state.features).some((item) =>
    item.steps.some((step) => step.status === 'running'),
  );
  const otherPilot = allFeatures(state.features).some(
    (item) => item.id !== feature.id && item.autopilot?.status === 'running',
  );
  const attention =
    feature.steps.find((step) => step.attempts.at(-1)?.navigationRequest) ??
    feature.steps.find((step) =>
      ['waiting_input', 'awaiting_review', 'failed', 'interrupted', 'cancelled'].includes(
        step.status,
      ),
    ) ??
    feature.steps.find((step) => step.id === feature.optionalRequest?.stepId);
  const attentionLabel = attention?.attempts.at(-1)?.navigationRequest
    ? 'Compléter la navigation'
    : attention?.status === 'awaiting_review'
      ? 'Relire le résultat'
      : attention?.status === 'waiting_input'
        ? 'Répondre ou reprendre'
        : 'Ouvrir l’étape à débloquer';
  const blocked =
    Boolean(feature.optionalRequest) ||
    Boolean(state.workspaceOperation) ||
    active ||
    otherPilot ||
    feature.archived ||
    !state.workspace.trusted ||
    state.runtime.state !== 'ready' ||
    !state.runtime.authenticated ||
    (state.humanRequests ?? []).some((r) => r.featureId === feature.id) ||
    feature.steps.every(stepResolved);
  return (
    <div className="autopilot-panel">
      <section className={`autopilot-bar ${auto?.status ?? 'idle'}`}>
        <span className="autopilot-symbol">
          <Sparkles size={21} />
        </span>
        <div>
          <h3>
            Autopilot{' '}
            <span>
              {auto?.status === 'running'
                ? 'En cours'
                : auto?.status === 'paused'
                  ? 'En pause'
                  : auto?.status === 'completed'
                    ? 'Parcours terminé'
                    : 'À votre rythme'}
            </span>
          </h3>
          {auto?.reason && <p role="status">{auto.reason}</p>}
          {!auto?.reason && blocked && (
            <p className="field-help">
              {!state.workspace.trusted
                ? 'Approuve le projet pour démarrer.'
                : state.runtime.state !== 'ready' || !state.runtime.authenticated
                  ? 'Connecte Copilot pour démarrer.'
                  : active || otherPilot || state.workspaceOperation
                    ? 'Attends la fin de l’opération en cours.'
                    : feature.steps.every(stepResolved)
                      ? 'Le parcours attend sa validation définitive humaine.'
                      : 'Une décision humaine attend ta réponse.'}
            </p>
          )}
          {attention && selectStep && auto?.status === 'paused' && (
            <button
              className="text-button"
              onClick={() => {
                selectStep(attention.id);
                requestAnimationFrame(() =>
                  document.querySelector('.step-layout')?.scrollIntoView({ block: 'start' }),
                );
              }}
            >
              {attentionLabel}
            </button>
          )}
          {auto && (
            <small>
              {auto.runs} / {auto.maxRuns} exécutions · {auto.correctionCycles} /{' '}
              {auto.maxCorrectionCycles} cycles de correction
            </small>
          )}
        </div>
        <div className="autopilot-actions">
          {feature.steps.some((step) => step.status === 'running') && (
            <button
              className="button secondary small"
              onClick={() => dispatch({ type: 'cancelRun', featureId: feature.id })}
            >
              <Square size={13} /> Arrêter maintenant
            </button>
          )}
          <button
            className="text-button"
            disabled={
              !feature.steps.length ||
              active ||
              otherPilot ||
              Boolean(state.workspaceOperation) ||
              feature.archived ||
              auto?.status === 'running'
            }
            onClick={() => setEditing(true)}
          >
            <Settings2 size={14} /> Configurer
          </button>
          {auto?.status === 'running' ? (
            <button
              className="button secondary small"
              onClick={() => dispatch({ type: 'pauseAutopilot', featureId: feature.id })}
            >
              <Pause size={13} /> Demander la pause
            </button>
          ) : (
            <button
              className="button secondary small"
              disabled={Boolean(blocked)}
              onClick={() => (auto ? setStarting(true) : setEditing(true))}
            >
              <Play size={13} />
              {auto?.status === 'paused' ? 'Reprendre l’autopilot' : 'Activer l’autopilot'}
            </button>
          )}
        </div>
      </section>
      {!!auto?.decisions?.length && (
        <details className="autopilot-journal">
          <summary>Journal du pilote · {auto.decisions.length} décisions conservées</summary>
          <ol>
            {[...auto.decisions].reverse().map((decision, index) => (
              <li key={index}>
                <time>{new Date(decision.at).toLocaleString('fr-FR')}</time>
                {' · '}
                {decision.stepId && (
                  <strong>
                    {feature.steps.find((step) => step.id === decision.stepId)?.name ??
                      decision.stepId}{' '}
                    ·{' '}
                  </strong>
                )}
                {decision.message}
                <small>
                  {' '}
                  {decision.runs} appel(s) · {decision.correctionCycles} correction(s)
                </small>
              </li>
            ))}
          </ol>
        </details>
      )}
      {editing && (
        <AutopilotEditor
          feature={feature}
          state={state}
          dispatch={dispatch}
          onClose={() => setEditing(false)}
        />
      )}{' '}
      {starting && (
        <StudioDialog
          title="Confier la suite à l’autopilot ?"
          subtitle="Vérifie les prochaines étapes, leurs arrêts et le contexte transmis. Les questions et permissions humaines suspendent le pilote."
          onClose={() => setStarting(false)}
        >
          <div className="autopilot-summary">
            {!preview && !previewError && <p role="status">Vérification du parcours…</p>}
            {previewError && (
              <p role="alert" className="inline-error">
                {previewError}
              </p>
            )}
            {preview && (
              <>
                <p>
                  <strong>Prochaine action : {preview.next}</strong>
                </p>
                <p>
                  {preview.remainingRuns} exécutions et {preview.remainingCorrections} corrections
                  restantes.
                </p>
                {!!preview.errors.length && (
                  <ul role="alert" className="inline-error">
                    {preview.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                )}
                <ol className="autopilot-preflight">
                  {preview.steps.map((step) => (
                    <li key={step.id}>
                      <strong>{step.name}</strong>
                      <ul>
                        {step.notes.map((note, index) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <p>
              <Flag size={15} /> Points de contrôle :{' '}
              {auto?.checkpoints
                .map((id) => feature.steps.find((s) => s.id === id)?.name ?? id)
                .join(', ') || 'Aucun checkpoint choisi'}
            </p>
            <p>
              <Gauge size={15} /> Au plus {auto?.maxRuns} exécutions et {auto?.maxCorrectionCycles}{' '}
              cycles de correction.
            </p>
            <p>
              <ShieldCheck size={15} /> Le budget de la session et les permissions des étapes
              restent applicables.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setStarting(false)}>
              Revenir
            </button>
            <button
              className="button primary"
              disabled={
                Boolean(blocked) ||
                !preview ||
                Boolean(previewError) ||
                Boolean(preview.errors.length)
              }
              onClick={() => {
                dispatch({ type: 'startAutopilot', featureId: feature.id });
                setStarting(false);
              }}
            >
              <Play size={14} /> Démarrer l’autopilot
            </button>
          </div>
        </StudioDialog>
      )}
    </div>
  );
}
function AutopilotEditor({
  feature,
  state,
  dispatch,
  onClose,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const current = feature.autopilot;
  const [config, setConfig] = useState<AutopilotConfig>({
    checkpoints:
      current?.checkpoints ??
      (feature.steps.some((s) => ['plan', 'review'].includes(s.id))
        ? feature.steps.filter((s) => ['plan', 'review'].includes(s.id)).map((s) => s.id)
        : feature.steps.slice(-1).map((s) => s.id)),
    maxRuns: current?.maxRuns ?? feature.steps.length,
    maxCorrectionCycles: current?.maxCorrectionCycles ?? 0,
    reviewStepId: current?.reviewStepId,
    correctionStepId: current?.correctionStepId,
    stepInputs:
      current?.stepInputs ??
      Object.fromEntries(feature.steps.map((s) => [s.id, blankLaunch(s, feature)])),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<string | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'autopilotSaved' || message.requestId !== request.current) return;
        setSaving(false);
        if (message.error) setError(message.error);
        else closeRef.current();
      }),
    [],
  );
  const same = (ids: string[]) =>
    ids.length === config.checkpoints.length && ids.every((id) => config.checkpoints.includes(id));
  const profile = same(feature.steps.map((step) => step.id))
    ? 'guided'
    : same([])
      ? 'autonomous'
      : same(balancedCheckpoints(feature))
        ? 'balanced'
        : 'custom';
  const correctionCandidates = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    return (feature.steps.find((step) => step.id === id)?.dependsOn ?? []).flatMap((dep) => [
      dep,
      ...correctionCandidates(dep, seen),
    ]);
  };
  const [stepId, setStepId] = useState(feature.activeStepId);
  const step = feature.steps.find((s) => s.id === stepId) ?? feature.steps[0];
  const input =
    config.stepInputs[step?.id] ??
    (step
      ? blankLaunch(step, feature)
      : { initialContext: '', mcpServerIds: [], memoryIds: [], useProjectMemory: false });
  const updateInput = (patch: Partial<typeof input>) =>
    setConfig({
      ...config,
      stepInputs: { ...config.stepInputs, [step.id]: { ...input, ...patch } },
    });
  return (
    <StudioDialog
      title="Un parcours autonome, un cap humain."
      subtitle="Définissez les arrêts, le budget d’exécution et le contexte transmis à chaque étape. Aucun lancement pendant cette configuration."
      onClose={() => {
        if (!saving) onClose();
      }}
      className="autopilot-dialog"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (saving) return;
          request.current = crypto.randomUUID();
          setSaving(true);
          setError('');
          dispatch({
            type: 'saveAutopilot',
            featureId: feature.id,
            config,
            requestId: request.current,
          });
        }}
      >
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={saving} className="autopilot-fields">
          <div className="autopilot-editor-grid">
            <section>
              <span className="eyebrow">LE CADRE DU PARCOURS</span>
              <label className="field">
                <span>Profil d’autonomie</span>
                <select
                  value={profile}
                  disabled={Boolean(feature.parent)}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value !== 'custom')
                      setConfig({
                        ...config,
                        checkpoints:
                          value === 'guided'
                            ? feature.steps.map((step) => step.id)
                            : value === 'balanced'
                              ? balancedCheckpoints(feature)
                              : [],
                      });
                  }}
                >
                  <option value="guided">Valider chaque étape</option>
                  <option value="balanced">Valider le plan et la revue</option>
                  <option value="autonomous">Enchaîner jusqu’au bilan</option>
                  <option value="custom">Personnalisé</option>
                </select>
                <small>
                  Ces profils règlent les validations. Les permissions Copilot et les validations
                  obligatoires restent indépendantes.
                </small>
              </label>
              <fieldset className="checkpoint-list">
                <legend>Validation humaine après ces étapes</legend>
                {feature.steps.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={Boolean(feature.parent) || config.checkpoints.includes(s.id)}
                      disabled={Boolean(feature.parent)}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          checkpoints: e.target.checked
                            ? [...config.checkpoints, s.id]
                            : config.checkpoints.filter((id) => id !== s.id),
                        })
                      }
                    />
                    <span>
                      {s.name}
                      <small>{s.policy}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {feature.parent && (
                <p className="field-help">
                  Dans une sous-équipe, chaque étape attend ta validation, y compris le code avant
                  les tests.
                </p>
              )}
              <div className="field-row">
                <label className="field">
                  <span>Nombre maximal d’exécutions</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={config.maxRuns}
                    onChange={(e) => setConfig({ ...config, maxRuns: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Cycles de correction maximum</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    required
                    value={config.maxCorrectionCycles}
                    onChange={(e) =>
                      setConfig({ ...config, maxCorrectionCycles: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              {config.maxCorrectionCycles > 0 && (
                <>
                  <label className="field">
                    <span>Étape qui relit les changements</span>
                    <select
                      required
                      value={config.reviewStepId ?? ''}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          reviewStepId: e.target.value,
                          correctionStepId: undefined,
                        })
                      }
                    >
                      <option value="">Choisir l’étape…</option>
                      {feature.steps.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Étape qui applique les corrections</span>
                    <select
                      required
                      value={config.correctionStepId ?? ''}
                      onChange={(e) => setConfig({ ...config, correctionStepId: e.target.value })}
                    >
                      <option value="">Choisir l’étape…</option>
                      {feature.steps
                        .filter((s) =>
                          correctionCandidates(config.reviewStepId ?? '').includes(s.id),
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              <p className="field-help">
                Une question, une permission MCP, un budget atteint ou un échec suspend l’autopilot.
                Vous pouvez demander sa pause à tout moment.
              </p>
            </section>
            <section className="autopilot-inputs">
              <span className="eyebrow">LE CONTEXTE, ÉTAPE PAR ÉTAPE</span>
              <div className="step-input-tabs">
                {feature.steps.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={step.id === s.id ? 'active' : ''}
                    onClick={() => setStepId(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Contexte initial de {step.name}</span>
                <textarea
                  rows={6}
                  value={input.initialContext}
                  onChange={(e) => updateInput({ initialContext: e.target.value })}
                  placeholder="Votre US, vos critères ou les précisions utiles pour cette étape."
                />
              </label>
              <NavigationLaunchPicker
                data={state.navigation}
                value={input.omitNavigation ? undefined : (input.navigation ?? feature.navigation)}
                onChange={(navigation) => updateInput({ navigation, omitNavigation: !navigation })}
              />
              {needsDevOpsEvidence(step) && (
                <p className="field-help">
                  Cette étape démarrera manuellement : les références du test hors production seront
                  demandées à ce moment.
                </p>
              )}
              <McpPicker
                state={state}
                selected={input.mcpServerIds}
                onChange={(mcpServerIds) => updateInput({ mcpServerIds })}
              />
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={input.useProjectMemory}
                  onChange={(e) =>
                    updateInput({ useProjectMemory: e.target.checked, memoryIds: [] })
                  }
                />
                <span>
                  Sélectionner de la mémoire pour cet agent
                  <small>
                    Pas d’appel IA supplémentaire. Injection limitée à 4 000 caractères.
                  </small>
                </span>
              </label>
              {input.useProjectMemory && (
                <MemoryPicker
                  state={state}
                  agentId={step.agentId}
                  selected={input.memoryIds}
                  onChange={(memoryIds) => updateInput({ memoryIds })}
                />
              )}
              <p className="field-help">
                {step.askBeforeRun
                  ? 'Cette étape demande un contexte humain avant exécution.'
                  : 'Cette étape utilise ce contexte sans ouvrir le panneau de lancement manuel.'}{' '}
                Le réglage « demander avant exécution » se modifie dans la configuration de l’étape.
              </p>
            </section>
          </div>
        </fieldset>
        <div className="modal-actions">
          <span className="muted">Les limites ne déclenchent aucune exécution.</span>
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
            Annuler
          </button>
          <button className="button primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer l’autopilot'} <Check size={15} />
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
