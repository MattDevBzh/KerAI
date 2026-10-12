import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  FileText,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Play,
  Plug,
  Plus,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import type {
  ClientMessage,
  Feature,
  FeatureStep,
  HumanRequest,
  McpServerConfig,
  RunLaunchOptions,
  RunPreview,
  StudioState,
} from '../src/shared/types';
import { isDemo, subscribe } from './bridge';
export type Dispatch = (message: ClientMessage) => void;
export function StudioDialog({
  title,
  subtitle,
  children,
  onClose,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const nodes = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex="0"]') ??
          [],
      ).filter((n) => !n.hasAttribute('disabled'));
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const n = nodes(),
          first = n[0],
          last = n.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal wide ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-dialog-title"
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <h2 id="studio-dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Fermer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function McpPicker({
  state,
  selected,
  onChange,
}: {
  state: StudioState;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const servers = state.settings.mcpServers?.filter((s) => s.enabled) ?? [];
  return (
    <fieldset className="mcp-picker">
      <legend>
        <Plug size={14} /> Connexions MCP autorisées pour ce lancement
      </legend>
      {servers.length ? (
        servers.map((server) => (
          <label
            key={server.id}
            className={`mcp-choice ${selected.includes(server.id) ? 'selected' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(server.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, server.id]
                    : selected.filter((id) => id !== server.id),
                )
              }
            />
            <span>
              <strong>{server.name}</strong>
              <small>
                {server.transport} · {server.tools.filter(Boolean).length} outil
                {server.tools.filter(Boolean).length > 1 ? 's' : ''} autorisé
                {server.tools.filter(Boolean).length > 1 ? 's' : ''}
              </small>
            </span>
            <span
              className={`catalog-dot ${state.mcpCatalogs?.[server.id]?.state ?? 'unchecked'}`}
              title={state.mcpCatalogs?.[server.id]?.state ?? 'Non testé'}
            />
          </label>
        ))
      ) : (
        <p className="muted">
          Aucun serveur MCP activé. Vous pouvez en configurer dans les réglages.
        </p>
      )}
      <p className="field-help">
        Chaque outil reste soumis à sa liste d’autorisation et aux permissions de l’étape. Aucun
        accès générique n’est accordé.
      </p>
    </fieldset>
  );
}
export function LaunchDialog({
  feature,
  step,
  state,
  resume,
  feedback: initialFeedback,
  dispatch,
  onClose,
}: {
  feature: Feature;
  step: FeatureStep;
  state: StudioState;
  resume: boolean;
  feedback: string;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const previous = step.attempts.at(-1)?.launch;
  const configured = feature.autopilot?.stepInputs[step.id];
  const [launch, setLaunch] = useState<RunLaunchOptions>({
    initialContext:
      previous?.initialContext ?? configured?.initialContext ?? step.initialContext ?? '',
    mcpServerIds: (
      previous?.mcpServerIds ??
      configured?.mcpServerIds ??
      step.mcpServerIds ??
      []
    ).filter((id) => state.settings.mcpServers?.some((s) => s.id === id && s.enabled)),
    memoryIds: [],
    useProjectMemory: false,
  });
  const [feedback, setFeedback] = useState(initialFeedback);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef('');
  const submitted = useRef(false);
  const revision = JSON.stringify({
    feature,
    agents: state.agents,
    skills: state.skills,
    settings: state.settings,
    memory: state.memory,
    runtime: state.runtime,
  });
  const priorRevision = useRef(revision);
  const invalidate = () => {
    request.current = '';
    setPreview(null);
    setPending(false);
    setError('');
  };
  useEffect(() => {
    if (priorRevision.current !== revision) {
      priorRevision.current = revision;
      invalidate();
    }
  }, [revision]);
  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'runPreview' && message.requestId === request.current) {
          setPreview(message.preview);
          setPending(false);
        }
        if (message.type === 'error' && request.current) {
          setError(message.message);
          setPending(false);
          setPreview(null);
        }
      }),
    [],
  );
  const update = (patch: Partial<RunLaunchOptions>) => {
    setLaunch({ ...launch, ...patch });
    invalidate();
  };
  const prepare = () => {
    const id = crypto.randomUUID();
    request.current = id;
    setPending(!isDemo);
    setError(
      isDemo
        ? 'Démonstration : cet aperçu nécessite le host VS Code. Aucune instruction n’a été exécutée.'
        : '',
    );
    setPreview(null);
    dispatch({
      type: 'previewRun',
      requestId: id,
      featureId: feature.id,
      stepId: step.id,
      feedback: feedback.trim(),
      resume,
      launch,
    });
  };
  const eligible =
    state.workspace.trusted &&
    state.runtime.state === 'ready' &&
    !feature.archived &&
    !feature.steps.some((s) => s.status === 'running') &&
    step.attempts.length < step.maxAttempts;
  const canStart =
    eligible &&
    preview !== null &&
    preview.errors.length === 0 &&
    preview.featureId === feature.id &&
    preview.stepId === step.id &&
    !pending &&
    !submitted.current;

  return (
    <StudioDialog
      title={resume ? 'Reprendre avec le bon contexte.' : 'Le prochain pas commence ici.'}
      subtitle={`${step.name} · ${feature.title}. Vérifiez les instructions avant de confier le travail à l’agent.`}
      onClose={onClose}
      className="launch-dialog"
    >
      <div className="launch-grid">
        <div className="launch-inputs">
          <span className="eyebrow">VOTRE INTENTION</span>
          <label className="field">
            <span>US, demande ou contexte initial</span>
            <textarea
              rows={7}
              value={launch.initialContext}
              onChange={(e) => update({ initialContext: e.target.value })}
              placeholder="Collez votre user story, vos critères d’acceptation, les contraintes et les informations utiles à cette exécution."
            />
            <small>
              Ce texte accompagne cette tentative. Les instructions de l’agent et les livrables
              précédents sont ajoutés par le host.
            </small>
          </label>
          <label className="field">
            <span>Retour pour cette tentative</span>
            <textarea
              rows={3}
              value={feedback}
              onChange={(e) => {
                setFeedback(e.target.value);
                invalidate();
              }}
              placeholder="Précisez la direction, les corrections ou les détails à conserver…"
            />
          </label>
          <McpPicker
            state={state}
            selected={launch.mcpServerIds}
            onChange={(mcpServerIds) => update({ mcpServerIds })}
          />
          <div className="memory-optin">
            <label>
              <input
                type="checkbox"
                checked={launch.useProjectMemory}
                onChange={(e) => update({ useProjectMemory: e.target.checked, memoryIds: [] })}
              />
              <span>
                <strong>Inclure la mémoire du projet</strong>
                <small>
                  Optionnel · désactivé pour chaque lancement · sans appel IA supplémentaire
                </small>
              </span>
            </label>
            {launch.useProjectMemory && (
              <MemoryPicker
                state={state}
                agentId={step.agentId}
                selected={launch.memoryIds}
                onChange={(memoryIds) => update({ memoryIds })}
              />
            )}
          </div>
        </div>
        <section className="prompt-preview" aria-live="polite">
          <div className="section-heading">
            <h3>
              <FileText size={15} /> Les instructions réelles
            </h3>
            {preview && (
              <span className="preview-verified">
                <Fingerprint size={13} /> Aperçu host
              </span>
            )}
          </div>
          {preview ? (
            <>
              <div className="prompt-metrics">
                <span>
                  <strong>{preview.characters.toLocaleString('fr-FR')}</strong> caractères /{' '}
                  {preview.maxCharacters.toLocaleString('fr-FR')}
                </span>
                <span>
                  <strong>≈ {preview.estimatedTokens.toLocaleString('fr-FR')}</strong> tokens
                  estimés
                </span>
              </div>
              {preview.errors.map((e, i) => (
                <div className="inline-error" key={i}>
                  <TriangleAlert size={14} />
                  {e}
                </div>
              ))}
              <div className="preview-sections">
                {preview.sections.map((s) => (
                  <details key={s.id} open={s.source === 'human'}>
                    <summary>
                      {s.label}
                      <span>{s.source}</span>
                    </summary>
                    <pre>{s.content}</pre>
                  </details>
                ))}
              </div>
              <details className="assembled-prompt">
                <summary>Lire le prompt assemblé complet</summary>
                <pre>{preview.prompt}</pre>
              </details>
              <p className="field-help">
                L’estimation n’est pas une consommation mesurée. Toute modification du contexte
                exige un nouvel aperçu.
              </p>
            </>
          ) : (
            <div className="preview-empty">
              <span>
                <Fingerprint size={29} />
              </span>
              <h3>
                Un lancement lisible,
                <br />
                avant d’être une exécution.
              </h3>
              <p>
                Préparez l’aperçu pour relire exactement le contexte composé par le host : votre
                demande, l’agent, les skills, les livrables et la mémoire sélectionnée.
              </p>
              <span className="preview-note">
                <ShieldCheck size={13} /> L’aperçu n’appelle aucun modèle IA.
              </span>
            </div>
          )}
          {error && (
            <div className="inline-error" role="alert">
              <TriangleAlert size={14} />
              {error}
            </div>
          )}
          <button className="button secondary" disabled={pending} onClick={prepare}>
            {pending ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}{' '}
            {preview ? 'Actualiser l’aperçu' : 'Préparer l’aperçu'}
          </button>
        </section>
      </div>
      <div className="modal-actions">
        <span className="muted">
          <ShieldCheck size={14} />
          {resume
            ? 'Reprise de la session existante.'
            : 'Une tentative consommera votre quota Copilot.'}
        </span>
        <button className="button secondary" onClick={onClose}>
          Revenir
        </button>
        <button
          className="button primary"
          disabled={!canStart}
          onClick={() => {
            if (!preview || !canStart) return;
            submitted.current = true;
            dispatch({
              type: 'runStep',
              featureId: feature.id,
              stepId: step.id,
              feedback: feedback.trim(),
              resume,
              launch,
              previewFingerprint: preview.fingerprint,
            });
            onClose();
          }}
        >
          <Play size={14} />
          {resume ? 'Lancer la reprise' : 'Lancer cette étape'}
        </button>
      </div>
    </StudioDialog>
  );
}
export function MemoryPicker({
  state,
  agentId,
  selected,
  onChange,
}: {
  state: StudioState;
  agentId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const entries = (state.memory ?? []).filter(
    (m) => !m.agentIds.length || m.agentIds.includes(agentId),
  );
  const count = entries.filter((m) => m.enabled && selected.includes(m.id)).length;
  return (
    <div className="memory-selection">
      {entries.map((m) => (
        <label key={m.id} className={!m.enabled ? 'disabled-memory' : ''}>
          <input
            type="checkbox"
            disabled={!m.enabled}
            checked={m.enabled && selected.includes(m.id)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id),
              )
            }
          />
          <span>
            {m.title}
            {!m.enabled && <small> · Désactivée</small>}
          </span>
        </label>
      ))}
      {!entries.length && <p className="muted">Aucune note pour cet agent.</p>}
      <p className="field-help">
        {count === 0
          ? '0 note sélectionnée : aucune mémoire ne sera injectée.'
          : `${count} note${count > 1 ? 's' : ''} explicitement sélectionnée${count > 1 ? 's' : ''}.`}{' '}
        Maximum 4 000 caractères au total, sans appel IA.
      </p>
    </div>
  );
}
export function HumanRequests({
  requests,
  dispatch,
}: {
  requests: HumanRequest[];
  dispatch: Dispatch;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className="human-requests">
      {requests.map((r) => (
        <section className={`human-request ${r.kind}`} key={r.id}>
          <span className="eyebrow">
            {r.kind === 'mcp-permission' ? <ShieldCheck size={13} /> : <MessageSquare size={13} />}{' '}
            {r.kind === 'mcp-permission' ? 'AUTORISATION MCP' : 'VOTRE RÉPONSE EST NÉCESSAIRE'}
          </span>
          <h3>{r.question}</h3>
          {r.details && <pre>{r.details}</pre>}
          {r.kind === 'mcp-permission' ? (
            <div className="human-actions">
              <button
                className="button secondary small"
                onClick={() =>
                  dispatch({ type: 'answerHumanRequest', requestId: r.id, answer: 'deny' })
                }
              >
                Refuser
              </button>
              <button
                className="button primary small"
                onClick={() =>
                  dispatch({ type: 'answerHumanRequest', requestId: r.id, answer: 'allow' })
                }
              >
                <ShieldCheck size={13} /> Autoriser cette demande
              </button>
            </div>
          ) : (
            <>
              <div className="human-choices">
                {r.choices?.map((choice) => (
                  <button
                    key={choice}
                    className={`button small ${answers[r.id] === choice ? 'primary' : 'secondary'}`}
                    onClick={() => setAnswers({ ...answers, [r.id]: choice })}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              {r.allowFreeform && (
                <label className="field">
                  <span>Votre réponse</span>
                  <textarea
                    rows={3}
                    value={answers[r.id] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [r.id]: e.target.value })}
                  />
                </label>
              )}
              <button
                className="button primary small"
                disabled={!answers[r.id]?.trim()}
                onClick={() =>
                  dispatch({
                    type: 'answerHumanRequest',
                    requestId: r.id,
                    answer: answers[r.id].trim(),
                  })
                }
              >
                Transmettre la réponse <Check size={14} />
              </button>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
function HeaderMapping({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const [text, setText] = useState(
    Object.entries(value)
      .map(([header, key]) => `${header}=${key}`)
      .join('\n'),
  );
  return (
    <label className="field">
      <span>
        En-têtes HTTP <small>nom=clé du secret, un par ligne</small>
      </span>
      <textarea
        rows={2}
        className="code-input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            Object.fromEntries(
              e.target.value
                .split('\n')
                .filter((line) => line.includes('='))
                .map((line) => {
                  const i = line.indexOf('=');
                  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
                }),
            ),
          );
        }}
        placeholder="Authorization=MCP_AUTH_TOKEN"
      />
      <small>Indiquez une référence au secret, jamais sa valeur.</small>
    </label>
  );
}
function SecretInput({
  serverId,
  saved,
  trusted,
  dispatch,
}: {
  serverId: string;
  saved?: McpServerConfig;
  trusted: boolean;
  dispatch: Dispatch;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const referenced = Boolean(
    saved &&
      (saved.envKeys.includes(key.trim()) || Object.values(saved.headers).includes(key.trim())),
  );
  return (
    <div className="mcp-secret">
      <div className="field-row">
        <label className="field">
          <span>Clé du secret</span>
          <input
            value={key}
            autoComplete="off"
            onChange={(e) => setKey(e.target.value)}
            placeholder="MCP_AUTH_TOKEN"
          />
        </label>
        <label className="field">
          <span>Valeur du secret</span>
          <input
            type="password"
            maxLength={16000}
            value={value}
            autoComplete="new-password"
            onChange={(e) => setValue(e.target.value)}
            placeholder="Jamais relue par le cockpit"
          />
        </label>
      </div>
      <button
        type="button"
        className="button secondary small"
        disabled={!trusted || !saved || !referenced || !value}
        onClick={() => {
          dispatch({ type: 'setMcpSecret', serverId, key: key.trim(), value });
          setValue('');
        }}
      >
        <KeyRound size={13} /> Enregistrer dans le coffre VS Code
      </button>
      <p className="field-help">
        Enregistrez d’abord le serveur et cette référence dans ses clés d’environnement ou en-têtes.
        Le host protège le secret ; sa valeur n’est jamais incluse dans l’état ou l’export.
      </p>
    </div>
  );
}
export function McpSettings({
  servers,
  state,
  onChange,
  dispatch,
}: {
  servers: McpServerConfig[];
  state: StudioState;
  onChange: (servers: McpServerConfig[]) => void;
  dispatch: Dispatch;
}) {
  const [organisation, setOrganisation] = useState('');
  const [azureAuth, setAzureAuth] = useState('interactive');
  const update = (id: string, patch: Partial<McpServerConfig>) =>
    onChange(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <section className="settings-card mcp-settings">
      <div className="settings-card-title">
        <span className="settings-icon color-2">
          <Plug size={21} />
        </span>
        <div>
          <h2>Connexions MCP</h2>
          <p>
            Des outils externes choisis, des permissions explicites, des secrets dans le coffre.
          </p>
        </div>
        <span className="count-pill">{servers.filter((s) => s.enabled).length} actifs</span>
      </div>
      <div className="azure-mcp-preset">
        <div>
          <span className="eyebrow">CONNECTER VOTRE BACKLOG</span>
          <h3>Azure DevOps, au plus près de vos US.</h3>
          <p>
            Le preset fournit uniquement la lecture des work items. La découverte ouvrira la
            connexion interactive si nécessaire.
          </p>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Organisation Azure DevOps</span>
            <input
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
              placeholder="mon-organisation"
            />
          </label>
          <label className="field">
            <span>Authentification Azure DevOps</span>
            <select value={azureAuth} onChange={(e) => setAzureAuth(e.target.value)}>
              <option value="interactive">Connexion interactive</option>
              <option value="azcli">Azure CLI · az login existant</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="button secondary small"
          disabled={!organisation.trim()}
          onClick={() => {
            onChange([
              ...servers,
              {
                id: `mcp-${crypto.randomUUID()}`,
                name: `Azure DevOps · ${organisation.trim()}`,
                transport: 'stdio',
                command: 'npx',
                args: [
                  '-y',
                  '@azure-devops/mcp@2.10.0',
                  organisation.trim(),
                  '-d',
                  'work-items',
                  '--authentication',
                  azureAuth,
                ],
                envKeys: [],
                headers: {},
                tools: ['wit_work_item'],
                autoApproveReadOnly: true,
                enabled: false,
              },
            ]);
            setOrganisation('');
          }}
        >
          <Plus size={14} /> Ajouter le preset Azure DevOps
        </button>
      </div>
      <div className="hook-note">
        <ShieldCheck size={17} />
        <p>
          Un serveur ajouté reste désactivé. Seuls les noms d’outils inscrits dans votre liste sont
          autorisés ; aucun wildcard. La découverte teste le serveur sans appel IA.
        </p>
      </div>
      {servers.map((server) => {
        const catalog = state.mcpCatalogs?.[server.id];
        const saved = state.settings.mcpServers?.some((s) => s.id === server.id);
        return (
          <div className="mcp-server" key={server.id}>
            <div className="command-heading">
              <span className="eyebrow">
                <Plug size={13} /> {server.name || 'NOUVEAU SERVEUR'}
              </span>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={(e) => update(server.id, { enabled: e.target.checked })}
                />
                <span className="toggle-switch" />
                <strong>{server.enabled ? 'Activé' : 'Désactivé'}</strong>
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Supprimer le serveur ${server.name}`}
                onClick={() => onChange(servers.filter((s) => s.id !== server.id))}
              >
                <X size={15} />
              </button>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Nom du serveur</span>
                <input
                  required
                  value={server.name}
                  onChange={(e) => update(server.id, { name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Transport</span>
                <select
                  aria-label={`Transport de ${server.name}`}
                  value={server.transport}
                  onChange={(e) =>
                    update(server.id, {
                      transport: e.target.value as McpServerConfig['transport'],
                      ...(e.target.value === 'stdio' ? { url: undefined } : { command: undefined }),
                    })
                  }
                >
                  <option value="stdio">Processus local · stdio</option>
                  <option value="http">HTTP</option>
                  <option value="sse">Server-Sent Events · SSE</option>
                </select>
              </label>
            </div>
            {server.transport === 'stdio' ? (
              <div className="field-row">
                <label className="field">
                  <span>Exécutable MCP</span>
                  <input
                    required
                    value={server.command ?? ''}
                    onChange={(e) => update(server.id, { command: e.target.value })}
                    placeholder="node"
                  />
                </label>
                <label className="field">
                  <span>
                    Arguments MCP <small>un par ligne</small>
                  </span>
                  <textarea
                    rows={2}
                    className="code-input"
                    value={server.args.join('\n')}
                    onChange={(e) => update(server.id, { args: e.target.value.split('\n') })}
                    placeholder="/chemin/serveur.mjs"
                  />
                </label>
              </div>
            ) : (
              <label className="field">
                <span>URL du serveur MCP</span>
                <input
                  type="url"
                  required
                  value={server.url ?? ''}
                  onChange={(e) => update(server.id, { url: e.target.value })}
                  placeholder="https://votre-serveur.example/mcp"
                />
              </label>
            )}
            <div className="field-row">
              <label className="field">
                <span>
                  Outils autorisés <small>un nom brut par ligne</small>
                </span>
                <textarea
                  className="code-input"
                  rows={3}
                  value={server.tools.join('\n')}
                  onChange={(e) => update(server.id, { tools: e.target.value.split('\n') })}
                  placeholder={'search_documents\nread_document'}
                />
                <small>
                  Une liste vide n’autorise aucun outil. Les caractères * ne sont pas permis.
                </small>
              </label>
              <label className="field">
                <span>
                  Clés d’environnement <small>noms des variables ou secrets</small>
                </span>
                <textarea
                  rows={3}
                  className="code-input"
                  value={server.envKeys.join('\n')}
                  onChange={(e) => update(server.id, { envKeys: e.target.value.split('\n') })}
                  placeholder="MCP_AUTH_TOKEN"
                />
              </label>
            </div>
            {server.transport !== 'stdio' && (
              <HeaderMapping
                value={server.headers}
                onChange={(headers) => update(server.id, { headers })}
              />
            )}
            <label className="inline-check">
              <input
                type="checkbox"
                checked={server.autoApproveReadOnly}
                onChange={(e) => update(server.id, { autoApproveReadOnly: e.target.checked })}
              />
              <span>
                Autoriser automatiquement les outils signalés en lecture seule
                <small>Les autres appels demandent toujours une décision humaine.</small>
              </span>
            </label>
            <div className="mcp-discovery">
              <button
                type="button"
                className="button secondary small"
                disabled={!saved || catalog?.state === 'checking' || !state.workspace.trusted}
                onClick={() => dispatch({ type: 'testMcp', serverId: server.id })}
              >
                {catalog?.state === 'checking' ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Search size={14} />
                )}{' '}
                Découvrir les outils
              </button>
              <span className="muted">
                {!saved
                  ? 'Enregistrez le serveur pour le tester.'
                  : catalog?.state === 'ready'
                    ? `${catalog.tools.length} outils découverts`
                    : catalog?.state === 'checking'
                      ? 'Connexion en cours…'
                      : 'Aucun appel IA'}
              </span>
            </div>
            {catalog?.error && (
              <div className="inline-error">
                <TriangleAlert size={14} />
                {catalog.error}
              </div>
            )}
            {catalog?.tools.length ? (
              <div className="catalog-tools">
                {catalog.tools.map((tool) => (
                  <label key={tool.name}>
                    <input
                      type="checkbox"
                      checked={server.tools.includes(tool.name)}
                      onChange={(e) =>
                        update(server.id, {
                          tools: e.target.checked
                            ? [...server.tools.filter(Boolean), tool.name]
                            : server.tools.filter((t) => t !== tool.name),
                        })
                      }
                    />
                    <span>
                      <strong>{tool.name}</strong>
                      <small>{tool.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            <SecretInput
              serverId={server.id}
              saved={state.settings.mcpServers?.find((s) => s.id === server.id)}
              trusted={state.workspace.trusted}
              dispatch={dispatch}
            />
          </div>
        );
      })}
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          onChange([
            ...servers,
            {
              id: `mcp-${crypto.randomUUID()}`,
              name: 'Nouveau serveur',
              transport: 'stdio',
              command: '',
              args: [],
              envKeys: [],
              headers: {},
              tools: [],
              autoApproveReadOnly: false,
              enabled: false,
            },
          ])
        }
      >
        <Plus size={15} /> Ajouter un serveur MCP
      </button>
    </section>
  );
}
