import { orderedAgents } from '../src/shared/team';
import { toCredits, toNanoAiu, formatCredits } from '../src/shared/credits';
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { subscribe } from './bridge';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileCheck2,
  FileCode2,
  Flag,
  Gauge,
  GitBranch,
  GripVertical,
  Layers,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Workflow,
  X,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { QualityPanel } from './QualityUI';
import { DevOpsEvidencePanel } from './DevOpsKitUI';
import type {
  AcceptanceCriterion,
  Attempt,
  AutopilotConfig,
  ClientMessage,
  Feature,
  FeatureBudget,
  FeatureStep,
  MemoryEntry,
  ModelProfile,
  StudioSettings,
  StudioState,
  Workflow as WorkflowType,
  WorkflowStep,
} from '../src/shared/types';
import { HumanRequests, McpPicker, MemoryPicker, StudioDialog, type Dispatch } from './ExecutionUI';
import { usageTotals, defaultBudget } from '../src/core/budgets';
const number = (v: number) => v.toLocaleString('fr-FR');
const stamp = (v: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
const slug = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const blankLaunch = (step: FeatureStep) => ({
  initialContext: step.initialContext ?? '',
  mcpServerIds: step.mcpServerIds ?? [],
  memoryIds: [],
  useProjectMemory: false,
});
export function attentionCount(state: StudioState) {
  return new Set([
    ...state.features
      .filter((f) => !f.archived && f.status === 'awaiting_final_validation')
      .map((f) => `${f.id}:final`),
    ...(state.humanRequests ?? []).map((r) => `${r.featureId}:${r.stepId}`),
    ...state.features
      .filter((f) => !f.archived)
      .flatMap((f) =>
        f.steps
          .filter((s) =>
            ['waiting_input', 'awaiting_review', 'failed', 'stale', 'interrupted'].includes(
              s.status,
            ),
          )
          .map((s) => `${f.id}:${s.id}`),
      ),
  ]).size;
}
export function AutopilotBar({
  feature,
  state,
  dispatch,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: Dispatch;
}) {
  const [editing, setEditing] = useState(false),
    [starting, setStarting] = useState(false);
  const auto = feature.autopilot;
  const blocked =
    Boolean(state.workspaceOperation) ||
    state.features.some((f) => f.steps.some((s) => s.status === 'running')) ||
    feature.archived ||
    !state.workspace.trusted ||
    state.runtime.state !== 'ready' ||
    (state.humanRequests ?? []).some((r) => r.featureId === feature.id) ||
    !feature.steps.some((s) => s.status !== 'approved');
  return (
    <>
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
          <p>
            {auto?.reason ??
              (auto
                ? 'Le parcours suit vos points de contrôle et votre budget.'
                : 'Configurez le contexte de chaque étape et les décisions qui restent entre vos mains.')}
          </p>
          {auto && (
            <small>
              {auto.runs} / {auto.maxRuns} exécutions · {auto.correctionCycles} /{' '}
              {auto.maxCorrectionCycles} cycles de correction
            </small>
          )}
        </div>
        <div className="autopilot-actions">
          <button
            className="text-button"
            disabled={!feature.steps.length || auto?.status === 'running'}
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
          subtitle="Le host avancera dans le parcours en respectant ces limites. Les questions et permissions humaines interrompent sa progression."
          onClose={() => setStarting(false)}
        >
          <div className="autopilot-summary">
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
              disabled={Boolean(blocked)}
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
    </>
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
      current?.stepInputs ?? Object.fromEntries(feature.steps.map((s) => [s.id, blankLaunch(s)])),
  });
  const [stepId, setStepId] = useState(feature.activeStepId);
  const step = feature.steps.find((s) => s.id === stepId) ?? feature.steps[0];
  const input =
    config.stepInputs[step?.id] ??
    (step
      ? blankLaunch(step)
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
      onClose={onClose}
      className="autopilot-dialog"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({ type: 'saveAutopilot', featureId: feature.id, config });
          onClose();
        }}
      >
        <div className="autopilot-editor-grid">
          <section>
            <span className="eyebrow">LE CADRE DU PARCOURS</span>
            <fieldset className="checkpoint-list">
              <legend>Validation humaine après ces étapes</legend>
              {feature.steps.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={config.checkpoints.includes(s.id)}
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
                    onChange={(e) => setConfig({ ...config, reviewStepId: e.target.value })}
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
                      .filter((s) => s.id !== config.reviewStepId)
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
            <McpPicker
              state={state}
              selected={input.mcpServerIds}
              onChange={(mcpServerIds) => updateInput({ mcpServerIds })}
            />
            <label className="inline-check">
              <input
                type="checkbox"
                checked={input.useProjectMemory}
                onChange={(e) => updateInput({ useProjectMemory: e.target.checked, memoryIds: [] })}
              />
              <span>
                Sélectionner de la mémoire pour cet agent
                <small>Pas d’appel IA supplémentaire. Injection limitée à 4 000 caractères.</small>
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
        <div className="modal-actions">
          <span className="muted">Les limites ne déclenchent aucune exécution.</span>
          <button type="button" className="button secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="button primary">
            Enregistrer l’autopilot <Check size={15} />
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
const profileLabels: Record<ModelProfile, string> = {
  current: 'Conserver les modèles des étapes',
  economy: 'Économie',
  balanced: 'Équilibré',
  quality: 'Qualité',
};
function proposedBudget(state: StudioState, feature?: Feature): FeatureBudget {
  return feature?.budget ?? state.settings.budgetDefaults ?? { ...defaultBudget };
}
function BudgetFields({
  value,
  onChange,
}: {
  value: FeatureBudget;
  onChange: (b: FeatureBudget) => void;
}) {
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Nombre maximal d’exécutions</span>
          <input
            required
            type="number"
            min={1}
            max={1000}
            value={value.maxRuns}
            onChange={(e) => onChange({ ...value, maxRuns: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Caractères maximum du prompt</span>
          <input
            required
            type="number"
            min={1000}
            max={500000}
            step={1000}
            value={value.maxPromptChars}
            onChange={(e) => onChange({ ...value, maxPromptChars: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>
            Seuil de tokens mesurés <small>facultatif</small>
          </span>
          <input
            type="number"
            min={0}
            value={value.maxTokens ?? ''}
            onChange={(e) =>
              onChange({ ...value, maxTokens: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="Aucune limite de tokens définie"
          />
        </label>
        <label className="field">
          <span>
            Seuil de crédits IA <small>facultatif</small>
          </span>
          <input
            type="number"
            min={0}
            step="any"
            value={value.maxNanoAiu === undefined ? '' : toCredits(value.maxNanoAiu)}
            onChange={(e) =>
              onChange({
                ...value,
                maxNanoAiu: e.target.value ? toNanoAiu(Number(e.target.value)) : undefined,
              })
            }
            placeholder="Aucune limite de crédits définie"
          />
        </label>
      </div>
      <label className="field">
        <span>Profil de modèles</span>
        <select
          value={value.modelProfile}
          onChange={(e) => onChange({ ...value, modelProfile: e.target.value as ModelProfile })}
        >
          {Object.entries(profileLabels).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
        <small>
          Les profils utilisent uniquement les modèles que vous avez associés dans les réglages. Les
          seuils de tokens et crédits arrêtent AVANT la tentative suivante ; ils ne plafonnent pas
          une facture ni la consommation de la tentative en cours.
        </small>
      </label>
    </>
  );
}
export function BudgetMeter({
  feature,
  state,
  dispatch,
}: {
  feature: Feature;
  state: StudioState;
  dispatch: Dispatch;
}) {
  const totals = usageTotals(feature);
  const tokens = totals.inputTokens + totals.outputTokens;
  const unknown = totals.unknownTokenRuns;
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(proposedBudget(state, feature));
  const live = feature.budget ?? state.settings.budgetDefaults ?? defaultBudget;
  return (
    <>
      <section className="budget-meter">
        <div className="budget-heading">
          <span className="eyebrow">
            <Gauge size={13} /> CONSOMMATION & CADRE
          </span>
          <button
            className="text-button"
            onClick={() => {
              setBudget(proposedBudget(state, feature));
              setEditing(true);
            }}
          >
            <Settings2 size={13} /> Budget
          </button>
        </div>
        <div className="budget-stats">
          <div>
            <strong>
              {number(totals.runs)}
              {live && <small> / {live.maxRuns}</small>}
            </strong>
            <span>tentatives réalisées</span>
          </div>
          <div>
            <strong>
              {tokens || unknown < totals.runs ? number(tokens) : '—'}
              {live?.maxTokens && <small> / {number(live.maxTokens)}</small>}
            </strong>
            <span>
              tokens mesurés{' '}
              {unknown > 0 &&
                `· ${unknown} tentative${unknown > 1 ? 's' : ''} avec mesure absente ou partielle`}
            </span>
          </div>
          <div>
            <strong>
              {totals.nanoAiu > 0 || totals.runs > totals.unknownCostRuns
                ? formatCredits(toCredits(totals.nanoAiu))
                : '—'}
              {live?.maxNanoAiu !== undefined && (
                <small> / {formatCredits(toCredits(live.maxNanoAiu))}</small>
              )}
            </strong>
            <span>crédits {totals.unknownCostRuns ? '· mesure incomplète' : 'mesurés'}</span>
          </div>
        </div>
        {live && (
          <div
            className="budget-track"
            aria-label={`${totals.runs} tentatives sur ${live.maxRuns}`}
          >
            <span style={{ width: `${Math.min(100, (totals.runs / live.maxRuns) * 100)}%` }} />
          </div>
        )}
        <p className="field-help">
          {live
            ? `${profileLabels[live.modelProfile]} · ${number(live.maxPromptChars)} caractères maximum par prompt`
            : 'Définissez un budget pour encadrer les prochaines exécutions.'}{' '}
          Les valeurs inconnues ne comptent jamais comme des consommations nulles.
        </p>
      </section>
      {editing && (
        <StudioDialog
          title="Un budget pour avancer sereinement."
          subtitle="Les limites encadrent les prochaines exécutions. Aucun coût en euros n’est extrapolé."
          onClose={() => setEditing(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({ type: 'saveBudget', featureId: feature.id, budget });
              setEditing(false);
            }}
          >
            <BudgetFields value={budget} onChange={setBudget} />
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setEditing(false)}>
                Annuler
              </button>
              <button className="button primary">
                Enregistrer le budget <Check size={15} />
              </button>
            </div>
          </form>
        </StudioDialog>
      )}
    </>
  );
}
export function ModelBudgetSettings({
  settings,
  state,
  onChange,
}: {
  settings: StudioSettings;
  state: StudioState;
  onChange: (patch: Partial<StudioSettings>) => void;
}) {
  const update = (profile: Exclude<ModelProfile, 'current'>, model: string, reasoning?: string) =>
    onChange({ modelProfiles: { ...settings.modelProfiles, [profile]: { model, reasoning } } });
  return (
    <section className="settings-card">
      <div className="settings-card-title">
        <span className="settings-icon color-1">
          <Gauge size={21} />
        </span>
        <div>
          <h2>Budgets et profils de modèles</h2>
          <p>Associez vos profils aux identifiants réellement proposés par le runtime.</p>
        </div>
      </div>
      <div className="model-profile-grid">
        {(['economy', 'balanced', 'quality'] as const).map((profile) => {
          const value = settings.modelProfiles?.[profile];
          const model = value?.model ?? '';
          const known = state.runtime.models.find((m) => m.id === model);
          return (
            <div key={profile}>
              <span className="eyebrow">{profileLabels[profile].toUpperCase()}</span>
              <label className="field">
                <span>Modèle du profil {profileLabels[profile]}</span>
                <select value={model} onChange={(e) => update(profile, e.target.value)}>
                  <option value="">Non associé · automatique</option>
                  {model && !known && <option value={model}>{model} · configuré</option>}
                  {state.runtime.models.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              {Boolean(known?.reasoningEfforts?.length) && (
                <label className="field">
                  <span>Raisonnement du profil {profileLabels[profile]}</span>
                  <select
                    value={value?.reasoning ?? ''}
                    onChange={(e) => update(profile, model, e.target.value || undefined)}
                  >
                    <option value="">Automatique</option>
                    {known?.reasoningEfforts?.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </div>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={Boolean(settings.budgetDefaults)}
          onChange={(e) =>
            onChange({ budgetDefaults: e.target.checked ? proposedBudget(state) : undefined })
          }
        />
        <span>Définir un budget par défaut pour les nouvelles sessions</span>
      </label>
      {settings.budgetDefaults && (
        <BudgetFields
          value={settings.budgetDefaults}
          onChange={(budgetDefaults) => onChange({ budgetDefaults })}
        />
      )}
      <p className="field-help">
        Ce paramétrage n’appelle aucun modèle. Les profils ne déduisent aucune tarification ni
        qualité à partir du nom du modèle.
      </p>
    </section>
  );
}
export function EvidencePanel({
  attempt,
  featureId,
  dispatch,
}: {
  attempt?: Attempt;
  featureId?: string;
  dispatch?: (message: ClientMessage) => void;
}) {
  const evidence = attempt?.evidence ?? [];
  return (
    <div className="evidence-panel">
      <DevOpsEvidencePanel evidence={evidence} />
      <QualityPanel
        evidence={evidence}
        onOpenAttachment={(evidenceId, attachmentId) => {
          if (featureId)
            dispatch?.({ type: 'openQualityAttachment', featureId, evidenceId, attachmentId });
        }}
      />
      {featureId && dispatch && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => dispatch({ type: 'installQualityKit', featureId })}
        >
          Installer le reporter dans cette session
        </button>
      )}
      <div className="evidence-intro">
        <ShieldCheck size={21} />
        <div>
          <h3>Des preuves, au bon niveau.</h3>
          <p>
            Les sorties de commandes exécutées par le host sont distinctes du compte rendu produit
            par l’agent.
          </p>
        </div>
      </div>
      {evidence.length ? (
        evidence.map((e) => (
          <details
            className={`evidence-entry ${e.exitCode === 0 && !e.error && (!e.quality || e.quality.status === 'passed') ? 'passed' : 'failed'}`}
            key={e.id}
            open
          >
            <summary>
              <span className="evidence-status">
                {e.exitCode === 0 && !e.error && (!e.quality || e.quality.status === 'passed') ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <TriangleAlert size={16} />
                )}
              </span>
              <span>
                <strong>{e.name}</strong>
                <small>
                  {stamp(e.startedAt)} ·{' '}
                  {e.devops
                    ? 'Collecté par le host · test exécuté manuellement'
                    : e.source === 'host'
                      ? 'Exécuté par le host'
                      : 'Source non confirmée'}
                </small>
              </span>
              <span className="evidence-result">
                {e.exitCode === 0 && !e.error && (!e.quality || e.quality.status === 'passed')
                  ? 'Code 0'
                  : e.quality && e.quality.status !== 'passed'
                    ? 'Preuve qualité bloquante'
                    : e.exitCode === null
                      ? 'Pas de code de sortie'
                      : `Code ${e.exitCode}`}
              </span>
            </summary>
            <div className="evidence-body">
              <code>{[e.command, ...e.args].join(' ')}</code>
              {e.error && <div className="inline-error">{e.error}</div>}
              {e.stdout && (
                <details open>
                  <summary>Sortie standard</summary>
                  <pre>{e.stdout}</pre>
                </details>
              )}
              {e.stderr && (
                <details>
                  <summary>Sortie d’erreur</summary>
                  <pre>{e.stderr}</pre>
                </details>
              )}
              {e.truncated && (
                <p className="field-help">La sortie affichée a été tronquée par le host.</p>
              )}
              <details>
                <summary>Empreintes des fichiers · {Object.keys(e.fileHashes).length}</summary>
                <pre>
                  {Object.entries(e.fileHashes)
                    .map(([file, hash]) => `${file}  ${hash}`)
                    .join('\n') || 'Aucune empreinte associée.'}
                </pre>
              </details>
            </div>
          </details>
        ))
      ) : (
        <div className="evidence-empty">
          <FileCheck2 size={28} />
          <h3>Aucune commande attestée pour cette tentative.</h3>
          <p>
            Un livrable ou un message d’agent peut décrire un test. Les preuves d’exécution
            apparaîtront ici uniquement lorsqu’elles seront transmises par le host.
          </p>
        </div>
      )}
      {attempt?.review && (
        <section className="review-report">
          <span className="eyebrow">RELECTURE PRODUITE PAR L’AGENT</span>
          <h3>
            {attempt.review.verdict === 'pass'
              ? 'Aucun changement demandé'
              : 'Des corrections sont demandées'}
          </h3>
          <p>{attempt.review.summary}</p>
          {attempt.review.findings.map((f) => (
            <div className={`review-finding ${f.severity}`} key={f.id}>
              <Flag size={13} />
              <span>
                {f.message}
                {f.file && (
                  <small>
                    {f.file}
                    {f.line ? `:${f.line}` : ''}
                  </small>
                )}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
export function ValidationCenter({
  state,
  dispatch,
  onOpen,
}: {
  state: StudioState;
  dispatch: Dispatch;
  onOpen: (featureId: string, stepId: string) => void;
}) {
  const [filter, setFilter] = useState('all');
  const requests = state.humanRequests ?? [];
  const items = state.features
    .filter((f) => !f.archived)
    .flatMap((feature) =>
      feature.steps
        .filter((step) =>
          ['awaiting_review', 'waiting_input', 'failed', 'stale', 'interrupted'].includes(
            step.status,
          ),
        )
        .map((step) => ({ feature, step })),
    )
    .filter(
      ({ step }) =>
        filter === 'all' ||
        (filter === 'review'
          ? step.status === 'awaiting_review'
          : filter === 'question'
            ? step.status === 'waiting_input'
            : ['failed', 'stale', 'interrupted'].includes(step.status)),
    );
  return (
    <div className="page validation-page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">LES DÉCISIONS QUI FONT AVANCER</span>
          <h1>Votre regard, au bon moment.</h1>
          <p>
            Questions ouvertes, permissions, livrables à relire et preuves : les points d’attention
            du projet se retrouvent ici.
          </p>
        </div>
        <span className="validation-counter">
          <strong>{attentionCount(state)}</strong> points d’attention
        </span>
      </div>
      {requests.length > 0 && (
        <section className="validation-requests">
          <div className="section-heading">
            <h2>Les agents vous attendent</h2>
            <span className="count-pill">{requests.length}</span>
          </div>
          <HumanRequests requests={requests} dispatch={dispatch} />
        </section>
      )}
      <div className="section-heading">
        <h2>Dans vos parcours</h2>
        <label className="filter-select">
          <select
            aria-label="Filtrer le centre de validation"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Tous les points d’attention</option>
            <option value="review">Livrables à valider</option>
            <option value="question">Questions</option>
            <option value="repair">À reprendre ou actualiser</option>
          </select>
        </label>
      </div>
      <div className="validation-grid">
        {(filter === 'all' || filter === 'review') &&
          state.features
            .filter(
              (feature) => !feature.archived && feature.status === 'awaiting_final_validation',
            )
            .map((feature) => (
              <button
                className="validation-card"
                key={`${feature.id}-final`}
                onClick={() => onOpen(feature.id, feature.activeStepId)}
              >
                <span className="validation-kind">
                  <CheckCircle2 size={17} />
                  Dernière validation
                  <ArrowUpRight size={15} />
                </span>
                <h3>Bilan final du parcours</h3>
                <p>{feature.title}</p>
                <span>
                  {feature.steps.length} étapes validées · votre décision finale est attendue
                </span>
              </button>
            ))}
        {items.map(({ feature, step }) => {
          const attempt = step.attempts.at(-1);
          const blockers =
            feature.reviewComments?.filter(
              (c) =>
                c.stepId === step.id && c.attemptId === attempt?.id && c.blocking && !c.resolved,
            ).length ?? 0;
          return (
            <button
              className="validation-card"
              key={`${feature.id}-${step.id}`}
              onClick={() => onOpen(feature.id, step.id)}
            >
              <span className="validation-kind">
                <FileCheck2 size={17} />
                {step.status === 'awaiting_review'
                  ? 'Livrable à valider'
                  : step.status === 'waiting_input'
                    ? 'Réponse attendue'
                    : step.status === 'stale'
                      ? 'Contexte à actualiser'
                      : 'Tentative à reprendre'}
                <ArrowUpRight size={15} />
              </span>
              <h3>{step.name}</h3>
              <p>{feature.title}</p>
              <div className="validation-evidence">
                <span>{attempt?.artifact ? 'Livrable disponible' : 'Pas de livrable'}</span>
                <span>
                  {attempt?.evidence?.length ?? 0} preuve
                  {(attempt?.evidence?.length ?? 0) > 1 ? 's' : ''} host
                </span>
                {blockers > 0 && (
                  <span className="blocker-count">
                    {blockers} commentaire{blockers > 1 ? 's' : ''} bloquant
                    {blockers > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <span className="validation-card-footer">
                <GitBranch size={12} />
                {feature.branch}
                <ArrowRight size={15} />
              </span>
            </button>
          );
        })}
      </div>
      {!items.length &&
        !(
          (filter === 'all' || filter === 'review') &&
          state.features.some(
            (feature) => !feature.archived && feature.status === 'awaiting_final_validation',
          )
        ) && (
          <div className="evidence-empty">
            <CheckCircle2 size={29} />
            <h3>Le prochain mouvement est ailleurs.</h3>
            <p>
              Aucun livrable ne correspond à ce filtre. Les questions en direct restent accessibles
              au-dessus.
            </p>
          </div>
        )}
    </div>
  );
}
export function ReviewWorkspace({
  feature,
  step,
  attempt,
  state,
  dispatch,
  onCorrection,
  correctionDisabled = false,
}: {
  onCorrection?: (text: string, commentId?: string, findingId?: string) => void;
  correctionDisabled?: boolean;
  feature: Feature;
  step: FeatureStep;
  attempt?: Attempt;
  state: StudioState;
  dispatch: Dispatch;
}) {
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(
    structuredClone(feature.criteria ?? []),
  );
  const [text, setText] = useState(''),
    [file, setFile] = useState(''),
    [line, setLine] = useState(''),
    [blocking, setBlocking] = useState(false),
    [memory, setMemory] = useState<MemoryEntry | null>(null);
  const comments = (feature.reviewComments ?? []).filter(
    (c) => c.stepId === step.id && c.attemptId === attempt?.id,
  );
  const criteriaDirty = JSON.stringify(criteria) !== JSON.stringify(feature.criteria ?? []);
  return (
    <div className="review-workspace">
      {attempt?.review && (
        <section className="review-report">
          <h3>Relecture de l’agent</h3>
          <p>{attempt.review.summary}</p>
          {attempt.review.findings.map((finding) => (
            <div className={`review-finding ${finding.severity}`} key={finding.id}>
              <span>
                {finding.message}
                {finding.file && (
                  <small>
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ''}
                  </small>
                )}
              </span>
              {onCorrection && (
                <button
                  className="text-button"
                  disabled={correctionDisabled}
                  onClick={() => onCorrection(finding.message, undefined, finding.id)}
                >
                  Demander une correction
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <section>
        <div className="section-heading">
          <h3>Critères d’acceptation</h3>
          <button
            className="text-button"
            onClick={() =>
              setCriteria([
                ...criteria,
                { id: crypto.randomUUID(), text: '', status: 'pending', evidence: '' },
              ])
            }
          >
            <Plus size={13} /> Ajouter
          </button>
        </div>
        {criteria.map((criterion, i) => (
          <div className="criterion-row" key={criterion.id}>
            <span className="criterion-number">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <label className="field">
                <span className="sr-only">Critère {i + 1}</span>
                <input
                  value={criterion.text}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((c) =>
                        c.id === criterion.id ? { ...c, text: e.target.value } : c,
                      ),
                    )
                  }
                  placeholder="Un comportement observable et vérifiable"
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="sr-only">État du critère {i + 1}</span>
                  <select
                    value={criterion.status}
                    onChange={(e) =>
                      setCriteria(
                        criteria.map((c) =>
                          c.id === criterion.id
                            ? { ...c, status: e.target.value as AcceptanceCriterion['status'] }
                            : c,
                        ),
                      )
                    }
                  >
                    <option value="pending">À vérifier</option>
                    <option value="passed">Vérifié</option>
                    <option value="failed">Non satisfait</option>
                  </select>
                </label>
                <label className="field">
                  <span className="sr-only">Preuve du critère {i + 1}</span>
                  <input
                    value={criterion.evidence}
                    onChange={(e) =>
                      setCriteria(
                        criteria.map((c) =>
                          c.id === criterion.id ? { ...c, evidence: e.target.value } : c,
                        ),
                      )
                    }
                    placeholder="Preuve ou référence"
                  />
                </label>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label={`Supprimer le critère ${i + 1}`}
              onClick={() => setCriteria(criteria.filter((c) => c.id !== criterion.id))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {!criteria.length && (
          <p className="muted">
            Ajoutez les comportements qui vous feront considérer la feature comme réussie.
          </p>
        )}
        <button
          className="button secondary small"
          disabled={!criteriaDirty || criteria.some((c) => !c.text.trim())}
          onClick={() => dispatch({ type: 'saveCriteria', featureId: feature.id, criteria })}
        >
          Enregistrer les critères <Check size={13} />
        </button>
      </section>
      <section>
        <div className="section-heading">
          <h3>Notes de relecture</h3>
          <span className="count-pill">{comments.length}</span>
        </div>
        {comments.map((c) => (
          <div className={`review-comment ${c.resolved ? 'resolved' : ''}`} key={c.id}>
            <div>
              <span className="eyebrow">
                {c.blocking ? 'BLOQUANT' : 'NOTE'}
                {c.resolved ? ' · RÉSOLU' : ''}
              </span>
              <p>{c.text}</p>
              {c.file && (
                <button
                  className="text-button"
                  onClick={() =>
                    dispatch({ type: 'openFile', path: c.file!, featureId: feature.id })
                  }
                >
                  <FileCode2 size={12} />
                  {c.file}
                  {c.line ? `:${c.line}` : ''}
                </button>
              )}
            </div>
            {onCorrection && !c.resolved && (
              <button
                className="text-button"
                disabled={correctionDisabled}
                onClick={() => onCorrection(c.text, c.id)}
              >
                Demander une correction
              </button>
            )}
            <button
              className="text-button"
              onClick={() =>
                dispatch({
                  type: 'resolveReviewComment',
                  featureId: feature.id,
                  commentId: c.id,
                  resolved: !c.resolved,
                })
              }
            >
              {c.resolved ? 'Rouvrir' : 'Marquer résolu'}
              <Check size={12} />
            </button>
          </div>
        ))}
        <label className="field">
          <span>Un retour sur cette tentative</span>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Le problème observé, son impact et la correction attendue."
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>
              Fichier <small>facultatif</small>
            </span>
            <input
              value={file}
              onChange={(e) => setFile(e.target.value)}
              placeholder="src/composant.ts"
            />
          </label>
          <label className="field">
            <span>
              Ligne <small>facultatif</small>
            </span>
            <input type="number" min={1} value={line} onChange={(e) => setLine(e.target.value)} />
          </label>
        </div>
        <div className="comment-actions">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={blocking}
              onChange={(e) => setBlocking(e.target.checked)}
            />
            <span>Bloque la validation</span>
          </label>
          <button
            className="button secondary small"
            disabled={!text.trim() || !attempt}
            onClick={() => {
              if (!attempt) return;
              dispatch({
                type: 'addReviewComment',
                featureId: feature.id,
                comment: {
                  stepId: step.id,
                  attemptId: attempt.id,
                  text: text.trim(),
                  blocking,
                  ...(file.trim() ? { file: file.trim() } : {}),
                  ...(line ? { line: Number(line) } : {}),
                },
              });
              setText('');
            }}
          >
            Ajouter le commentaire
          </button>
        </div>
      </section>
      {step.status === 'approved' && attempt?.artifact && (
        <section className="memory-from-artifact">
          <BrainCircuit size={19} />
          <div>
            <h3>Une décision à retenir ?</h3>
            <p>
              Préparez une entrée locale à partir de ce livrable. Aucun résumé IA n’est demandé.
            </p>
          </div>
          <button
            className="button secondary small"
            onClick={() =>
              setMemory({
                id: crypto.randomUUID(),
                title: `${feature.title} · ${step.name}`,
                content: attempt.artifact!.content,
                category: 'decision',
                enabled: false,
                agentIds: [],
                updatedAt: new Date().toISOString(),
                source: { featureId: feature.id, stepId: step.id, attemptId: attempt.id },
              })
            }
          >
            Préparer une note <ArrowRight size={13} />
          </button>
        </section>
      )}
      {memory && (
        <MemoryEditor
          entry={memory}
          state={state}
          dispatch={dispatch}
          onClose={() => setMemory(null)}
        />
      )}
    </div>
  );
}
export function ProjectMemoryView({ state, dispatch }: { state: StudioState; dispatch: Dispatch }) {
  const [editor, setEditor] = useState<MemoryEntry | null>(null);
  const [deleting, setDeleting] = useState<MemoryEntry | null>(null);
  const [query, setQuery] = useState('');
  const memory = (state.memory ?? []).filter((m) =>
    `${m.title} ${m.content}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">CE QUE L’ATELIER RETIENT</span>
          <h1>La mémoire de votre projet.</h1>
          <p>
            Des conventions et décisions locales, relues par vous. L’injection dans les prompts
            reste une option explicite, sans appel IA supplémentaire.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            setEditor({
              id: crypto.randomUUID(),
              title: '',
              content: '',
              category: 'context',
              enabled: false,
              agentIds: [],
              updatedAt: new Date().toISOString(),
            })
          }
        >
          <Plus size={15} /> Nouvelle note
        </button>
      </div>
      <div className="memory-toolbar">
        <label className="search-field">
          <BrainCircuit size={15} />
          <input
            aria-label="Rechercher dans la mémoire"
            placeholder="Une convention, une décision…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="muted">
          {memory.length} note{memory.length > 1 ? 's' : ''} ·{' '}
          {memory.filter((m) => m.enabled).length} activée
          {memory.filter((m) => m.enabled).length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="memory-grid">
        {memory.map((m) => (
          <article className="memory-card" key={m.id}>
            <div className="section-heading">
              <span className="eyebrow">{m.category.toUpperCase()}</span>
              <span className={`memory-state ${m.enabled ? 'enabled' : ''}`}>
                {m.enabled ? 'Disponible à l’injection' : 'Conservée localement'}
              </span>
            </div>
            <h3>{m.title}</h3>
            <p>
              {m.content.slice(0, 260)}
              {m.content.length > 260 ? '…' : ''}
            </p>
            <div className="memory-meta">
              <span>{stamp(m.updatedAt)}</span>
              <span>{number(m.content.length)} caractères</span>
            </div>
            <div className="memory-card-actions">
              <button className="text-button" onClick={() => setEditor(m)}>
                Lire et ajuster <ArrowUpRight size={13} />
              </button>
              <button
                className="icon-button"
                aria-label={`Supprimer la note ${m.title}`}
                onClick={() => setDeleting(m)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!memory.length && (
        <div className="evidence-empty">
          <BrainCircuit size={30} />
          <h3>Une mémoire qui se construit avec vous.</h3>
          <p>
            Ajoutez une convention ou conservez une décision validée depuis une session. Les
            nouvelles notes sont désactivées pour l’injection par défaut.
          </p>
        </div>
      )}
      {editor && (
        <MemoryEditor
          entry={editor}
          state={state}
          dispatch={dispatch}
          onClose={() => setEditor(null)}
        />
      )}{' '}
      {deleting && (
        <StudioDialog
          title="Supprimer cette note ?"
          subtitle={`« ${deleting.title} » sera retirée de la mémoire locale du projet.`}
          onClose={() => setDeleting(null)}
        >
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              Revenir
            </button>
            <button
              className="button primary"
              onClick={() => {
                dispatch({ type: 'deleteMemory', id: deleting.id });
                setDeleting(null);
              }}
            >
              Supprimer la note
            </button>
          </div>
        </StudioDialog>
      )}
    </div>
  );
}
function MemoryEditor({
  entry,
  state,
  dispatch,
  onClose,
}: {
  entry: MemoryEntry;
  state: StudioState;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(entry));
  const [preview, setPreview] = useState(false);
  return (
    <StudioDialog
      title="Un repère pour les prochains pas."
      subtitle="Cette note reste locale. Vous choisissez si elle devient disponible pour l’injection dans les prompts."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({
            type: 'saveMemory',
            entry: { ...draft, title: draft.title.trim(), updatedAt: new Date().toISOString() },
          });
          onClose();
        }}
      >
        <div className="field-row">
          <label className="field">
            <span>Titre de la note</span>
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Catégorie</span>
            <select
              value={draft.category}
              onChange={(e) =>
                setDraft({ ...draft, category: e.target.value as MemoryEntry['category'] })
              }
            >
              <option value="context">Contexte</option>
              <option value="convention">Convention</option>
              <option value="architecture">Architecture</option>
              <option value="decision">Décision</option>
            </select>
          </label>
        </div>
        <div className="section-heading">
          <h3>Le contenu à retenir</h3>
          <button type="button" className="text-button" onClick={() => setPreview(!preview)}>
            {preview ? 'Éditer' : 'Aperçu Markdown'}
          </button>
        </div>
        {preview ? (
          <div className="skill-preview markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{draft.content}</Markdown>
          </div>
        ) : (
          <label className="field">
            <span className="sr-only">Contenu de la note</span>
            <textarea
              required
              maxLength={40000}
              rows={10}
              className="code-input"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </label>
        )}
        <label className="inline-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <span>
            Rendre cette note disponible pour les prompts
            <small>
              Le lancement doit encore activer l’inclusion de mémoire. Maximum 4 000 caractères
              injectés au total.
            </small>
          </span>
        </label>
        <fieldset className="skill-options">
          <legend>Agents concernés · aucun choisi = tous les agents</legend>
          {orderedAgents(state.agents, state.favoriteAgentIds).map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={draft.agentIds.includes(a.id)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    agentIds: e.target.checked
                      ? [...draft.agentIds, a.id]
                      : draft.agentIds.filter((id) => id !== a.id),
                  })
                }
              />
              {a.nickname || a.name}
            </label>
          ))}
        </fieldset>
        {draft.source && (
          <p className="field-help">
            Source : session {draft.source.featureId}, étape {draft.source.stepId}, tentative{' '}
            {draft.source.attemptId}.
          </p>
        )}
        <div className="modal-actions">
          <span className="muted">
            {number(draft.content.length)} caractères / 40 000 · aucun appel IA
          </span>
          <button type="button" className="button secondary" onClick={onClose}>
            Annuler
          </button>
          <button
            className="button primary"
            disabled={!draft.title.trim() || !draft.content.trim() || draft.content.length > 40000}
          >
            Enregistrer la note <Check size={14} />
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
function workflowErrors(workflow: WorkflowType, state: StudioState) {
  const errors: string[] = [];
  if (!workflow.name.trim()) errors.push('Donnez un nom au parcours.');
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(workflow.id))
    errors.push('L’identifiant doit commencer par une lettre.');
  if (!workflow.steps.length) errors.push('Ajoutez au moins une étape.');
  const ids = new Set(workflow.steps.map((s) => s.id));
  if (ids.size !== workflow.steps.length)
    errors.push('Les identifiants des étapes doivent être uniques.');
  const seen = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (seen.has(id)) return false;
    visiting.add(id);
    const step = workflow.steps.find((s) => s.id === id);
    for (const dep of step?.dependsOn ?? []) if (visit(dep)) return true;
    visiting.delete(id);
    seen.add(id);
    return false;
  };
  if (workflow.steps.some((s) => visit(s.id)))
    errors.push('Les dépendances forment un cycle. Retirez une liaison.');
  for (const s of workflow.steps) {
    if (!/^[^/\\]+\.md$/i.test(s.artifact))
      errors.push(`${s.name || 'Étape'} : le livrable doit être un fichier .md.`);
    if (!s.name.trim() || !s.artifact.trim())
      errors.push(`${s.name || 'Étape'} : nom et fichier livrable requis.`);
    if (!state.agents.some((a) => a.id === s.agentId))
      errors.push(`${s.name} : choisissez un agent disponible.`);
    if (s.dependsOn.some((d) => !ids.has(d)))
      errors.push(`${s.name} : une dépendance n’existe plus.`);
    if (s.maxAttempts < 1 || s.maxAttempts > 100)
      errors.push(`${s.name} : la limite doit être comprise entre 1 et 100 tentatives.`);
    if (s.artifact.includes('..') || s.artifact.includes('/') || s.artifact.includes('\\'))
      errors.push(`${s.name} : utilisez un nom de fichier simple pour le livrable.`);
  }
  return [...new Set(errors)];
}
function newStep(state: StudioState): WorkflowStep {
  const id = `etape-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: 'Nouvelle étape',
    description: '',
    agentId: state.agents[0]?.id ?? '',
    policy: 'read-only',
    skills: [],
    maxAttempts: 3,
    artifact: `${id}.md`,
    dependsOn: [],
    initialContext: '',
    mcpServerIds: [],
    askBeforeRun: false,
  };
}
export function WorkflowLibrary({ state, dispatch }: { state: StudioState; dispatch: Dispatch }) {
  const [deleting, setDeleting] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const deleteRequest = useRef('');
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type !== 'workflowDeleteResult' || message.requestId !== deleteRequest.current)
          return;
        setDeleting('');
        setDeleteError(message.error ?? '');
      }),
    [],
  );
  const [editor, setEditor] = useState<WorkflowType | null>(null);
  const [originalId, setOriginalId] = useState('');
  const open = (workflow: WorkflowType, isCopy = false) => {
    setOriginalId(isCopy ? '' : workflow.id);
    setEditor(
      isCopy
        ? {
            ...structuredClone(workflow),
            id: `${workflow.id}-copie-${Date.now().toString(36)}`,
            name: `${workflow.name} · copie`,
            source: undefined,
          }
        : structuredClone(workflow),
    );
  };
  return (
    <div className="page workflows-page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">VOTRE MANIÈRE D’AVANCER</span>
          <h1>Des parcours qui vous ressemblent.</h1>
          <p>
            Construisez visuellement les étapes, leur équipe et leurs dépendances. Les agents
            suivent vos règles, sans vous demander d’écrire du YAML.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setOriginalId('');
            setEditor({
              id: '',
              name: '',
              description: '',
              icon: 'layers',
              steps: [newStep(state)],
            });
          }}
        >
          <Plus size={15} /> Nouveau parcours
        </button>
      </div>
      <div className="workflow-library">
        {deleteError && (
          <p className="inline-error" role="alert">
            {deleteError}
          </p>
        )}
        {state.workflows.map((w) => (
          <article className="workflow-library-card" key={w.id}>
            <div className="section-heading">
              <span className="settings-icon color-2">
                <Workflow size={21} />
              </span>
              <span className="muted">{w.steps.length} étapes</span>
            </div>
            <h3>{w.name}</h3>
            <p>{w.description}</p>
            <div className="workflow-mini-map">
              {w.steps.map((s, i) => (
                <span key={s.id}>
                  <small>{String(i + 1).padStart(2, '0')}</small>
                  {s.name}
                  {i < w.steps.length - 1 && <ChevronRight size={10} />}
                </span>
              ))}
            </div>
            <div className="workflow-card-actions">
              <button className="text-button" onClick={() => open(w)}>
                Ouvrir l’éditeur <ArrowUpRight size={13} />
              </button>
              <button className="text-button" onClick={() => open(w, true)}>
                <Copy size={13} /> Dupliquer
              </button>
              <button
                className="text-button"
                aria-label={`Supprimer le parcours ${w.name}`}
                disabled={
                  Boolean(deleting) || !state.workspace.trusted || Boolean(state.workspaceOperation)
                }
                onClick={() => {
                  const requestId = crypto.randomUUID();
                  deleteRequest.current = requestId;
                  setDeleting(w.id);
                  setDeleteError('');
                  dispatch({ type: 'deleteWorkflow', workflowId: w.id, requestId });
                }}
              >
                <Trash2 size={13} /> {deleting === w.id ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!state.workflows.length && (
        <div className="evidence-empty">
          <Layers size={29} />
          <h3>Un premier parcours à dessiner.</h3>
          <p>
            Ajoutez une étape, un agent et les dépendances qui donnent du sens à la progression.
          </p>
        </div>
      )}
      {editor && (
        <WorkflowEditor
          initial={editor}
          existingId={originalId}
          state={state}
          dispatch={dispatch}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
function WorkflowEditor({
  initial,
  existingId,
  state,
  dispatch,
  onClose,
}: {
  initial: WorkflowType;
  existingId: string;
  state: StudioState;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const [workflow, setWorkflow] = useState(structuredClone(initial));
  const [selected, setSelected] = useState(initial.steps[0]?.id ?? '');
  const [deleting, setDeleting] = useState('');
  const step = workflow.steps.find((s) => s.id === selected);
  const errors = workflowErrors(workflow, state);
  const update = (patch: Partial<WorkflowStep>) =>
    setWorkflow({
      ...workflow,
      steps: workflow.steps.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
    });
  const move = (id: string, to: number) => {
    const from = workflow.steps.findIndex((s) => s.id === id);
    if (from === -1 || to < 0 || to >= workflow.steps.length) return;
    const steps = [...workflow.steps];
    const [item] = steps.splice(from, 1);
    steps.splice(to, 0, item);
    setWorkflow({ ...workflow, steps });
  };
  const add = () => {
    const next = newStep(state);
    if (workflow.steps.length) next.dependsOn = [workflow.steps.at(-1)!.id];
    setWorkflow({ ...workflow, steps: [...workflow.steps, next] });
    setSelected(next.id);
  };
  const duplicate = () => {
    if (!step) return;
    const copied = {
      ...structuredClone(step),
      id: `etape-${crypto.randomUUID().slice(0, 8)}`,
      name: `${step.name} · copie`,
    };
    copied.artifact = `${copied.id}.md`;
    const steps = [...workflow.steps];
    steps.splice(steps.findIndex((s) => s.id === step.id) + 1, 0, copied);
    setWorkflow({ ...workflow, steps });
    setSelected(copied.id);
  };
  return (
    <StudioDialog
      title={existingId ? workflow.name || 'Votre parcours' : 'Dessiner un nouveau parcours.'}
      subtitle="Enregistré au niveau utilisateur, disponible dans tous vos projets. Les sessions existantes conservent leurs étapes."
      onClose={onClose}
      className="workflow-editor-dialog"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!errors.length) {
            dispatch({ type: 'saveWorkflow', workflow: { ...workflow, source: undefined } });
            onClose();
          }
        }}
      >
        <div className="workflow-info">
          <label className="field">
            <span>Nom du parcours</span>
            <input
              required
              value={workflow.name}
              onChange={(e) =>
                setWorkflow({
                  ...workflow,
                  name: e.target.value,
                  ...(!existingId ? { id: slug(e.target.value) } : {}),
                })
              }
              placeholder="Du besoin à la livraison"
            />
          </label>
          <label className="field">
            <span>Identifiant du parcours</span>
            <input
              required
              disabled={Boolean(existingId)}
              value={workflow.id}
              onChange={(e) => setWorkflow({ ...workflow, id: e.target.value })}
              pattern="[a-zA-Z][a-zA-Z0-9_-]*"
            />
          </label>
          <label className="field">
            <span>Description du parcours</span>
            <input
              value={workflow.description}
              onChange={(e) => setWorkflow({ ...workflow, description: e.target.value })}
            />
          </label>
        </div>
        <div className="workflow-editor-grid">
          <section className="workflow-flow">
            <div className="section-heading">
              <h3>
                <GitBranch size={15} /> Les étapes & leurs liens
              </h3>
              <button type="button" className="text-button" onClick={add}>
                <Plus size={13} /> Étape
              </button>
            </div>
            <div
              className="workflow-nodes"
              style={{ minHeight: Math.max(workflow.steps.length * 94, 220) }}
            >
              <svg
                className="workflow-connectors"
                width="54"
                height={workflow.steps.length * 94}
                aria-hidden="true"
              >
                {workflow.steps.flatMap((s, to) =>
                  s.dependsOn.map((dep) => {
                    const from = workflow.steps.findIndex((x) => x.id === dep);
                    if (from < 0) return null;
                    const y1 = from * 94 + 39,
                      y2 = to * 94 + 39;
                    return (
                      <path
                        key={`${s.id}-${dep}`}
                        d={`M 51 ${y1} C 8 ${y1}, 8 ${y2}, 51 ${y2}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                    );
                  }),
                )}
              </svg>
              {workflow.steps.map((s, i) => (
                <div
                  className={`workflow-node ${s.id === selected ? 'selected' : ''}`}
                  key={s.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/feature-studio-step', s.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('application/feature-studio-step');
                    move(id, i);
                  }}
                >
                  <button
                    type="button"
                    className="node-main"
                    onClick={() => setSelected(s.id)}
                    aria-label={`Configurer l’étape ${s.name}`}
                  >
                    <GripVertical size={13} />
                    <span className="node-number">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {state.agents.find((a) => a.id === s.agentId)?.nickname ||
                          state.agents.find((a) => a.id === s.agentId)?.name ||
                          'Agent à choisir'}{' '}
                        ·{' '}
                        {s.dependsOn.length
                          ? s.dependsOn
                              .map((id) => workflow.steps.find((s) => s.id === id)?.name ?? id)
                              .join(', ')
                          : 'Point de départ'}
                      </small>
                    </span>
                  </button>
                  <div className="node-order">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={i === 0}
                      aria-label={`Monter ${s.name}`}
                      onClick={() => move(s.id, i - 1)}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={i === workflow.steps.length - 1}
                      aria-label={`Descendre ${s.name}`}
                      onClick={() => move(s.id, i + 1)}
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="field-help">
              Glissez les cartes ou utilisez les flèches. Une liaison signifie que la dépendance
              doit être validée avant l’étape.
            </p>
          </section>
          <section className="workflow-step-editor">
            {step ? (
              <>
                <div className="section-heading">
                  <span className="eyebrow">LE DÉTAIL DE L’ÉTAPE</span>
                  <div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Dupliquer cette étape"
                      onClick={duplicate}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Supprimer cette étape"
                      onClick={() => setDeleting(step.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <label className="field">
                  <span>Nom de l’étape</span>
                  <input
                    required
                    value={step.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Description de l’étape</span>
                  <textarea
                    rows={2}
                    value={step.description}
                    onChange={(e) => update({ description: e.target.value })}
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Agent de l’étape</span>
                    <select
                      value={step.agentId}
                      onChange={(e) => update({ agentId: e.target.value })}
                    >
                      <option value="">Choisir un agent…</option>
                      {orderedAgents(state.agents, state.favoriteAgentIds).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nickname || a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Permissions de l’étape</span>
                    <select
                      value={step.policy}
                      onChange={(e) => update({ policy: e.target.value as WorkflowStep['policy'] })}
                    >
                      <option value="read-only">Lecture seule</option>
                      <option value="workspace-write">Écriture dans le projet</option>
                      <option value="tests">Tests préautorisés</option>
                    </select>
                  </label>
                </div>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={
                      step.requiredDevOpsEvidence === true || step.agentId === 'fs-devops-validate'
                    }
                    disabled={step.agentId === 'fs-devops-validate'}
                    onChange={(e) => update({ requiredDevOpsEvidence: e.target.checked })}
                  />
                  <span>Exiger une preuve du test DevOps manuel</span>
                </label>
                <label className="field">
                  <span>Rapport qualité requis</span>
                  <select
                    aria-label="Rapport qualité requis"
                    value={step.requiredQuality ?? ''}
                    onChange={(event) =>
                      update({
                        requiredQuality: (event.target.value ||
                          undefined) as WorkflowStep['requiredQuality'],
                      })
                    }
                  >
                    <option value="">Selon l’agent sélectionné</option>
                    <option value="visual">Recette visuelle</option>
                    <option value="counterexample">Contre-exemples</option>
                  </select>
                  <small>
                    Un rapport hôte réussi, courant et lié aux critères est obligatoire pour la
                    validation humaine et automatique. Les agents de recette visuelle et
                    contre-exemples conservent leur exigence ; un choix différent exige les deux
                    rapports.
                  </small>
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Modèle de l’étape</span>
                    <select
                      value={step.model ?? ''}
                      onChange={(e) =>
                        update({ model: e.target.value || undefined, reasoning: undefined })
                      }
                    >
                      <option value="">Automatique</option>
                      {step.model && !state.runtime.models.some((m) => m.id === step.model) && (
                        <option value={step.model}>{step.model} · configuré</option>
                      )}
                      {state.runtime.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Limite de tentatives</span>
                    <input
                      required
                      type="number"
                      min={1}
                      max={100}
                      value={step.maxAttempts}
                      onChange={(e) => update({ maxAttempts: Number(e.target.value) })}
                    />
                  </label>
                </div>
                {Boolean(
                  state.runtime.models.find((m) => m.id === step.model)?.reasoningEfforts?.length,
                ) && (
                  <label className="field">
                    <span>Raisonnement de l’étape</span>
                    <select
                      value={step.reasoning ?? ''}
                      onChange={(e) => update({ reasoning: e.target.value || undefined })}
                    >
                      <option value="">Automatique</option>
                      {state.runtime.models
                        .find((m) => m.id === step.model)
                        ?.reasoningEfforts?.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>Nom du fichier livrable</span>
                  <input
                    required
                    value={step.artifact}
                    onChange={(e) => update({ artifact: e.target.value })}
                    placeholder="plan.md"
                  />
                </label>
                <fieldset className="dependency-list">
                  <legend>Doit attendre la validation de</legend>
                  {workflow.steps
                    .filter((s) => s.id !== step.id)
                    .map((s) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={step.dependsOn.includes(s.id)}
                          onChange={(e) =>
                            update({
                              dependsOn: e.target.checked
                                ? [...step.dependsOn, s.id]
                                : step.dependsOn.filter((id) => id !== s.id),
                            })
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                  {workflow.steps.length === 1 && (
                    <span className="muted">Une première étape n’a pas de dépendance.</span>
                  )}
                </fieldset>
                <fieldset className="skill-options">
                  <legend>Skills de l’étape</legend>
                  {state.skills.map((s) => (
                    <label key={s.id}>
                      <input
                        type="checkbox"
                        checked={step.skills.includes(s.id)}
                        onChange={(e) =>
                          update({
                            skills: e.target.checked
                              ? [...step.skills, s.id]
                              : step.skills.filter((id) => id !== s.id),
                          })
                        }
                      />
                      {s.name}
                    </label>
                  ))}
                </fieldset>
                <label className="field">
                  <span>Contexte initial du modèle</span>
                  <textarea
                    rows={3}
                    value={step.initialContext ?? ''}
                    onChange={(e) => update({ initialContext: e.target.value })}
                  />
                </label>
                <McpPicker
                  state={state}
                  selected={step.mcpServerIds ?? []}
                  onChange={(mcpServerIds) => update({ mcpServerIds })}
                />
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={step.askBeforeRun ?? false}
                    onChange={(e) => update({ askBeforeRun: e.target.checked })}
                  />
                  <span>Demander un contexte humain avant exécution automatique</span>
                </label>
              </>
            ) : (
              <p className="muted">Ajoutez une étape pour définir son rôle.</p>
            )}
          </section>
        </div>
        {errors.length > 0 && (
          <div className="workflow-errors" role="status">
            {errors.map((e) => (
              <p key={e}>
                <TriangleAlert size={13} />
                {e}
              </p>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <span className="muted">
            {workflow.steps.length} étape{workflow.steps.length > 1 ? 's' : ''} · aucune écriture
            YAML manuelle
          </span>
          <button type="button" className="button secondary" onClick={onClose}>
            Annuler
          </button>
          <button className="button primary" disabled={errors.length > 0}>
            Enregistrer le parcours <Check size={14} />
          </button>
        </div>
      </form>
      {deleting && (
        <div className="workflow-delete-confirm" role="alert">
          <p>
            Supprimer « {workflow.steps.find((s) => s.id === deleting)?.name} » ? Ses liaisons
            seront aussi retirées des autres étapes.
          </p>
          <div>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setDeleting('')}
            >
              Conserver
            </button>
            <button
              type="button"
              className="button primary small"
              onClick={() => {
                const steps = workflow.steps
                  .filter((s) => s.id !== deleting)
                  .map((s) => ({ ...s, dependsOn: s.dependsOn.filter((id) => id !== deleting) }));
                setWorkflow({ ...workflow, steps });
                setSelected(steps[0]?.id ?? '');
                setDeleting('');
              }}
            >
              Supprimer l’étape
            </button>
          </div>
        </div>
      )}
    </StudioDialog>
  );
}
