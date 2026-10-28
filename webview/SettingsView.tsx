import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Command,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClientMessage, StudioSettings, StudioState } from '../src/shared/types';
import { McpSettings } from './ExecutionUI';
import { hasActiveRun } from './GitWorkspaceUI';
import { TraceStorageSetting } from './ObservationUI';
import { ProjectSettings, ProjectSwitcher } from './ProjectUI';
import { QualityCommandFields, QualitySetup } from './QualityUI';
import { ModelBudgetSettings } from './StudioUI';
import { ThemePicker } from './ThemePicker';
import { ZoomSettings } from './ZoomControls';

import { Badge, Empty, ModelSelect } from './SessionPrimitives';

export function SettingsView({
  settings,
  state,
  automation,
  dispatch,
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
  settings: StudioSettings;
  state: StudioState;
  automation: boolean;
  dispatch: (m: ClientMessage) => void;
}) {
  const [draft, setDraft] = useState(structuredClone(settings));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const baseline = useRef(settings);
  useEffect(() => {
    if (JSON.stringify(baseline.current) !== JSON.stringify(settings)) {
      if (
        JSON.stringify(draft) === JSON.stringify(baseline.current) ||
        JSON.stringify(draft) === JSON.stringify(settings)
      )
        setDraft(structuredClone(settings));
      baseline.current = settings;
    }
  }, [settings]);
  useEffect(() => {
    dirtyCallback.current(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  const set = (patch: Partial<StudioSettings>) => setDraft({ ...draft, ...patch });
  const lines = (text: string) =>
    text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!state.workspace.trusted) return;
    dispatch({
      type: 'saveSettings',
      projectId: state.projectCatalog?.activeProjectId,
      settings: {
        ...draft,
        mcpServers: draft.mcpServers?.map((s) => ({
          ...s,
          args: s.args.filter(Boolean),
          tools: s.tools.map((t) => t.trim()).filter(Boolean),
          envKeys: s.envKeys.map((t) => t.trim()).filter(Boolean),
        })),
        testPaths: lines(draft.testPaths.join('\n')),
        testCommands: draft.testCommands.map((c) => ({
          ...c,
          args: c.args.filter((a) => a.length > 0),
        })),
        hooks: draft.hooks.map((h) => ({
          ...h,
          args: h.args.filter((a) => a.length > 0),
        })),
      },
    });
  };
  return (
    <div className="page settings-page">
      <div className="page-heading library-heading">
        <div>
          <span className="eyebrow">
            {automation ? 'LES RITUELS DE VOTRE ATELIER' : 'VOTRE ENVIRONNEMENT'}
          </span>
          <h1>
            {automation
              ? 'Un bon rythme, des règles claires.'
              : 'Les détails qui vous ressemblent.'}
          </h1>
          <p>
            {automation
              ? 'Configurez les scripts avant et après chaque exécution. Vous choisissez lesquels activer.'
              : 'Reliez votre runtime Copilot et définissez le cadre de travail de vos agents.'}
          </p>
        </div>
      </div>
      {!automation && (
        <nav className="settings-jump-links" aria-label="Sections des réglages">
          {[
            ['appearance', 'Apparence'],
            ['connection', 'Connexion'],
            ['projects', 'Projets'],
            ['mcp', 'MCP'],
            ['models', 'Modèles et budgets'],
            ['storage', 'Archives'],
            ['sessions', 'Sessions'],
            ['tests', 'Tests'],
          ].map(([id, label]) => (
            <a key={id} href={`#settings-${id}`}>
              {label}
            </a>
          ))}
        </nav>
      )}
      {!automation && (
        <section className="common-settings" aria-label="Réglages communs">
          <div className="settings-section-heading">
            <span className="eyebrow">COMMUN À TOUS LES PROJETS</span>
            <h2>Votre atelier</h2>
          </div>
          <div id="settings-appearance" className="settings-anchor">
            <ZoomSettings />
            <ThemePicker />
          </div>
          <section className="settings-card settings-anchor" id="settings-connection">
            <div className="settings-card-title">
              <span className="settings-icon color-2">
                <Command size={21} />
              </span>
              <div>
                <h2>GitHub Copilot CLI</h2>
                <p>Détection automatique du CLI installé. Un chemin personnalisé reste possible.</p>
              </div>
              <Badge
                label={
                  state.runtime.state === 'ready'
                    ? 'Connecté'
                    : state.runtime.state === 'checking'
                      ? 'Vérification'
                      : state.runtime.state === 'unavailable'
                        ? 'Indisponible'
                        : 'Non vérifié'
                }
                tone={
                  state.runtime.state === 'ready'
                    ? 'green'
                    : state.runtime.state === 'unavailable'
                      ? 'coral'
                      : 'neutral'
                }
              />
            </div>
            {state.runtime.error && (
              <div className="inline-error">
                <TriangleAlert size={16} />
                {state.runtime.error}
              </div>
            )}
            <div className="runtime-facts">
              <div>
                <span>Compte</span>
                <strong>{state.runtime.account ?? 'À vérifier'}</strong>
              </div>
              <div>
                <span>Version</span>
                <strong>{state.runtime.version ?? 'À vérifier'}</strong>
              </div>
              <div>
                <span>Modèles disponibles</span>
                <strong>{state.runtime.models.length || 'À vérifier'}</strong>
              </div>
            </div>
            <div className="runtime-location">
              <span>Chemin utilisé au dernier diagnostic</span>
              <code>{state.runtime.cliPath ?? 'Cliquez sur Vérifier la connexion.'}</code>
              {state.runtime.cliSource && (
                <small>
                  {state.runtime.cliSource === 'configured'
                    ? 'Chemin personnalisé'
                    : state.runtime.cliSource === 'path'
                      ? 'Détection automatique · PATH de VS Code'
                      : 'Détection automatique · installation utilisateur'}
                </small>
              )}
            </div>
            <div className="runtime-actions">
              <button
                type="button"
                className="button secondary"
                disabled={state.runtime.state === 'checking'}
                onClick={() => dispatch({ type: 'checkRuntime' })}
              >
                <RefreshCw size={15} /> Vérifier la connexion
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={state.runtime.state === 'checking'}
                onClick={() => dispatch({ type: 'autoDetectCli' })}
              >
                Détection automatique
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => dispatch({ type: 'openSettings' })}
              >
                Chemin du CLI dans VS Code <ArrowUpRight size={14} />
              </button>
            </div>
          </section>
          <div id="settings-projects" className="settings-anchor">
            <ProjectSettings state={state} dispatch={dispatch} dirty={dirty} />
          </div>
        </section>
      )}
      <section className="project-settings-heading" aria-label="Réglages du projet">
        <div>
          <span className="eyebrow">PARAMÈTRES PAR PROJET</span>
          <h2>{automation ? 'Automatisations du projet' : 'Configurer un projet'}</h2>
          <p className="project-current-settings">
            Les paramètres ci-dessous concernent{' '}
            <strong>
              {state.projectCatalog?.projects.find(
                (project) => project.id === state.projectCatalog?.activeProjectId,
              )?.name ?? state.workspace.name}
            </strong>
            .
          </p>
        </div>
        <ProjectSwitcher
          state={state}
          dispatch={dispatch}
          disabled={dirty || hasActiveRun(state)}
        />
      </section>
      <form onSubmit={submit}>
        {!automation && (
          <>
            <div id="settings-mcp" className="settings-anchor">
              <McpSettings
                servers={draft.mcpServers ?? []}
                state={state}
                onChange={(mcpServers) => set({ mcpServers })}
                dispatch={dispatch}
              />
            </div>
            <div id="settings-models" className="settings-anchor">
              <ModelBudgetSettings settings={draft} state={state} onChange={set} />
            </div>
            <div id="settings-storage" className="settings-anchor">
              <TraceStorageSetting
                value={draft.traceLimitBytes}
                onChange={(traceLimitBytes) => set({ traceLimitBytes })}
              />
            </div>
            <section className="settings-card settings-anchor" id="settings-sessions">
              <div className="settings-card-title">
                <span className="settings-icon color-0">
                  <Settings2 size={21} />
                </span>
                <div>
                  <h2>Préférences des sessions</h2>
                  <p>Des valeurs par défaut, ajustables à chaque étape.</p>
                </div>
              </div>
              <div className="field-row">
                <ModelSelect
                  state={state}
                  value={draft.defaultModel}
                  onChange={(defaultModel) => set({ defaultModel })}
                  label="Modèle par défaut"
                />
                <label className="field">
                  <span>Durée maximale d’une tentative</span>
                  <div className="input-unit">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      required
                      value={draft.timeoutMinutes}
                      onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })}
                    />
                    <span>minutes</span>
                  </div>
                </label>
              </div>
            </section>
            <section className="settings-card settings-anchor" id="settings-tests">
              <div className="settings-card-title">
                <span className="settings-icon color-1">
                  <CheckCircle2 size={21} />
                </span>
                <div>
                  <h2>Les commandes de test autorisées</h2>
                  <p>Un exécutable et des arguments explicites pour les étapes de test.</p>
                </div>
              </div>
              <div className="command-list">
                <QualitySetup
                  disabled={
                    !state.workspace.trusted ||
                    Boolean(state.workspaceOperation) ||
                    hasActiveRun(state)
                  }
                  onInstall={() => dispatch({ type: 'installQualityKit' })}
                />
                {draft.testCommands.map((command, i) => (
                  <div className="command-editor" key={command.id}>
                    <div className="command-heading">
                      <span className="eyebrow">COMMANDE {String(i + 1).padStart(2, '0')}</span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Supprimer ${command.name || 'la commande ' + (i + 1)}`}
                        onClick={() =>
                          set({
                            testCommands: draft.testCommands.filter((c) => c.id !== command.id),
                          })
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="field-row">
                      <label className="field">
                        <span>Nom</span>
                        <input
                          required
                          value={command.name}
                          onChange={(e) =>
                            set({
                              testCommands: draft.testCommands.map((c) =>
                                c.id === command.id ? { ...c, name: e.target.value } : c,
                              ),
                            })
                          }
                          placeholder="Tests unitaires"
                        />
                      </label>
                      <label className="field">
                        <span>Exécutable</span>
                        <input
                          required
                          value={command.command}
                          onChange={(e) =>
                            set({
                              testCommands: draft.testCommands.map((c) =>
                                c.id === command.id ? { ...c, command: e.target.value } : c,
                              ),
                            })
                          }
                          placeholder="npm"
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>
                        Arguments <small>un par ligne</small>
                      </span>
                      <textarea
                        rows={2}
                        className="code-input"
                        value={command.args.join('\n')}
                        onChange={(e) =>
                          set({
                            testCommands: draft.testCommands.map((c) =>
                              c.id === command.id ? { ...c, args: e.target.value.split('\n') } : c,
                            ),
                          })
                        }
                        placeholder={'run\ntest'}
                      />
                    </label>
                    <QualityCommandFields
                      config={command.quality}
                      onChange={(quality) =>
                        set({
                          testCommands: draft.testCommands.map((c) =>
                            c.id === command.id ? { ...c, quality } : c,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              {!draft.testCommands.length && (
                <p className="settings-empty">Aucune commande n’est autorisée pour le moment.</p>
              )}
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  set({
                    testCommands: [
                      ...draft.testCommands,
                      {
                        id: crypto.randomUUID(),
                        name: '',
                        command: '',
                        args: [],
                      },
                    ],
                  })
                }
              >
                <Plus size={14} /> Ajouter une commande
              </button>
              <label className="field test-paths">
                <span>
                  Dossiers de test <small>un par ligne</small>
                </span>
                <textarea
                  className="code-input"
                  rows={2}
                  value={draft.testPaths.join('\n')}
                  onChange={(e) => set({ testPaths: e.target.value.split('\n') })}
                  placeholder={'tests\ntest\n__tests__'}
                />
                <small>
                  Préfixes de dossiers uniquement, sans motif glob. Les fichiers de ces dossiers
                  sont accessibles dans le profil de test.
                </small>
              </label>
            </section>
          </>
        )}
        {automation && (
          <section className="settings-card">
            <div className="settings-card-title">
              <span className="settings-icon color-0">
                <Zap size={21} />
              </span>
              <div>
                <h2>Hooks du projet</h2>
                <p>Une action avant ou après l’exécution, uniquement si vous l’activez.</p>
              </div>
              <span className="count-pill">
                {draft.hooks.filter((h) => h.enabled).length} actifs
              </span>
            </div>
            <div className="hook-note">
              <ShieldCheck size={17} />
              <p>
                Un hook exécute une commande locale dans ce projet. Vérifiez l’exécutable et les
                arguments avant de l’activer. Chaque nouveau hook est désactivé par défaut.
              </p>
            </div>
            {draft.hooks.map((hook, i) => (
              <div className="hook-editor" key={hook.id}>
                <div className="command-heading">
                  <span className="hook-number">{String(i + 1).padStart(2, '0')}</span>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={hook.enabled}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, enabled: e.target.checked } : h,
                          ),
                        })
                      }
                    />
                    <span className="toggle-switch" />
                    <strong>{hook.enabled ? 'Activé' : 'Désactivé'}</strong>
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Supprimer ${hook.name || 'le hook ' + (i + 1)}`}
                    onClick={() =>
                      set({
                        hooks: draft.hooks.filter((h) => h.id !== hook.id),
                      })
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Nom du hook</span>
                    <input
                      required
                      value={hook.name}
                      placeholder="Préparer le contexte"
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, name: e.target.value } : h,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Quand l’exécuter ?</span>
                    <select
                      value={hook.event}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id
                              ? {
                                  ...h,
                                  event: e.target.value as 'beforeRun' | 'afterRun',
                                }
                              : h,
                          ),
                        })
                      }
                    >
                      <option value="beforeRun">Avant l’exécution · beforeRun</option>
                      <option value="afterRun">Après l’exécution · afterRun</option>
                    </select>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Exécutable</span>
                    <input
                      required
                      className="code-input"
                      value={hook.command}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, command: e.target.value } : h,
                          ),
                        })
                      }
                      placeholder="node"
                    />
                  </label>
                  <label className="field">
                    <span>
                      Arguments <small>un par ligne</small>
                    </span>
                    <textarea
                      rows={2}
                      className="code-input"
                      value={hook.args.join('\n')}
                      onChange={(e) =>
                        set({
                          hooks: draft.hooks.map((h) =>
                            h.id === hook.id ? { ...h, args: e.target.value.split('\n') } : h,
                          ),
                        })
                      }
                      placeholder="scripts/prepare.mjs"
                    />
                  </label>
                </div>
              </div>
            ))}
            {!draft.hooks.length && (
              <Empty icon={<Zap />} title="Un rituel à inventer">
                Préparer des fichiers avant une étape, produire un rapport après : les hooks
                s’adaptent à votre manière de travailler.
              </Empty>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                set({
                  hooks: [
                    ...draft.hooks,
                    {
                      id: crypto.randomUUID(),
                      name: '',
                      event: 'beforeRun',
                      command: '',
                      args: [],
                      enabled: false,
                    },
                  ],
                })
              }
            >
              <Plus size={15} /> Ajouter un hook
            </button>
          </section>
        )}
        <div className="settings-save" data-dirty={dirty}>
          <span role="status" aria-live="polite">
            {dirty ? 'Réglages du projet modifiés' : 'Aucune modification des réglages du projet'}
            {!automation && (
              <small>Les thèmes s’enregistrent automatiquement dès leur sélection.</small>
            )}
            <small id="settings-trust-status">
              {state.workspace.trusted
                ? 'Projet approuvé dans VS Code. Les nouvelles commandes vous seront présentées à l’enregistrement.'
                : 'Approbation requise dans VS Code pour enregistrer. Vos modifications sont conservées ici.'}
            </small>
          </span>
          {!state.workspace.trusted && (
            <button
              type="button"
              className="button secondary"
              onClick={() => dispatch({ type: 'manageWorkspaceTrust' })}
            >
              Gérer l’approbation dans VS Code <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
          {dirty && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setDraft(structuredClone(settings))}
            >
              Annuler les modifications
            </button>
          )}
          <button
            className="button primary"
            disabled={!dirty || !state.workspace.trusted}
            aria-describedby="settings-trust-status"
          >
            Enregistrer les réglages du projet <Check size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
