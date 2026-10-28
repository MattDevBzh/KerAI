import { Check, FileText } from 'lucide-react';
import { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { agentPolicy } from '../src/shared/agentInheritance';
import { resolveAvatar } from '../src/shared/avatars';
import type { ProfileSaveOptions, ProfileScope } from '../src/shared/profiles';
import {
  ROAST_LEVELS,
  normalizeRoastLevel,
  roastInstructions,
  roastLabel,
  type RoastLevel,
} from '../src/shared/roast';
import type { AgentProfile, ClientMessage, SkillInfo, StudioState } from '../src/shared/types';
import { AgentImage, Avatar, avatarOptions } from './Avatar';
import { ProfileScopeSelector, profileOptions, useProfileSave } from './ProfileScope';

import { Modal, ModelSelect } from './SessionPrimitives';

export function AgentEditor({
  agent,
  state,
  onClose,
  onMigrate,
  save,
}: {
  agent: AgentProfile | 'new';
  state: StudioState;
  onClose: () => void;
  onMigrate: () => void;
  save: (
    a: Extract<ClientMessage, { type: 'saveAgent' }>['agent'],
    options: ProfileSaveOptions,
    requestId: string,
  ) => void;
}) {
  const blank = agent === 'new';
  const source = blank ? null : agent;
  const [id, setId] = useState(source?.id ?? '');
  const [name, setName] = useState(source?.name ?? '');
  const [nickname, setNickname] = useState(source?.nickname ?? '');
  const [avatar, setAvatar] = useState(resolveAvatar(source?.avatar, source?.id));
  const [description, setDescription] = useState(source?.description ?? '');
  const [instructions, setInstructions] = useState(source?.instructions ?? '');
  const [tools, setTools] = useState(source?.tools.join(', ') ?? '');
  const [model, setModel] = useState(source?.model ?? '');
  const [reasoning, setReasoning] = useState(source?.reasoning ?? '');
  const [policy, setPolicy] = useState<NonNullable<AgentProfile['policy']>>(
    source ? agentPolicy(source) : 'read-only',
  );
  const [skills, setSkills] = useState(source?.skills ?? []);
  const [emptyContextByDefault, setEmptyContextByDefault] = useState(
    source?.emptyContextByDefault ?? false,
  );
  const [discussionAgent, setDiscussionAgent] = useState(source?.discussionAgent ?? false);
  const [roastLevel, setRoastLevel] = useState<RoastLevel>(normalizeRoastLevel(source?.roastLevel));
  const [scope, setScope] = useState<ProfileScope>(
    source?.source === 'workspace' ? 'workspace' : 'user',
  );
  const [origin, setOrigin] = useState(source);
  const drafts = useRef<
    Partial<
      Record<
        ProfileScope,
        {
          fields: {
            id: string;
            name: string;
            nickname: string;
            avatar: string;
            description: string;
            instructions: string;
            tools: string;
            model: string;
            reasoning: string;
            policy: NonNullable<AgentProfile['policy']>;
            skills: string[];
            emptyContextByDefault: boolean;
            discussionAgent: boolean;
            roastLevel: RoastLevel;
          };
          origin: typeof source;
        }
      >
    >
  >({});
  const saving = useProfileSave(onClose);
  const version = source?.versions?.find((version) => version.source === scope);
  const target =
    source?.targets?.[scope] ??
    (state.profileDirectories && {
      path: `${state.profileDirectories[scope]}/${scope === 'workspace' ? '.github/' : ''}agents/${id}.agent.md`,
      revision: null,
    });
  const collision = blank && state.agents.some((entry) => entry.id === id);
  const changeScope = (next: ProfileScope) => {
    drafts.current[scope] = {
      fields: {
        id,
        name,
        nickname,
        avatar,
        description,
        instructions,
        tools,
        model,
        reasoning,
        policy,
        skills,
        emptyContextByDefault,
        discussionAgent,
        roastLevel,
      },
      origin,
    };
    const cached = drafts.current[next];
    const existing = source?.versions?.find((version) => version.source === next);
    const chosen =
      cached?.fields ??
      (existing && {
        ...existing,
        nickname: existing.nickname ?? '',
        avatar: resolveAvatar(existing.avatar, existing.id),
        tools: existing.tools.join(', '),
        model: existing.model ?? '',
        reasoning: existing.reasoning ?? '',
        policy: agentPolicy(existing),
        emptyContextByDefault: existing.emptyContextByDefault ?? false,
        discussionAgent: existing.discussionAgent ?? false,
        roastLevel: normalizeRoastLevel(existing.roastLevel),
      });
    if (chosen) {
      setId(chosen.id);
      setName(chosen.name);
      setNickname(chosen.nickname);
      setAvatar(resolveAvatar(chosen.avatar, chosen.id));
      setDescription(chosen.description);
      setInstructions(chosen.instructions);
      setTools(chosen.tools);
      setModel(chosen.model);
      setReasoning(chosen.reasoning);
      setPolicy(chosen.policy);
      setSkills(chosen.skills);
      setEmptyContextByDefault(chosen.emptyContextByDefault);
      setDiscussionAgent(chosen.discussionAgent);
      setRoastLevel(chosen.roastLevel);
    }
    setOrigin(cached ? cached.origin : (existing ?? origin));
    setScope(next);
  };
  const slug = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return (
    <Modal
      title={blank ? 'Un nouveau membre de l’atelier.' : nickname || name}
      subtitle={
        blank
          ? 'Un rôle clair, un caractère à lui, et des instructions qui donnent le cap.'
          : source?.path
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saving.start((requestId) =>
            save(
              {
                id,
                name,
                description,
                instructions,
                tools: tools
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                model: model || undefined,
                reasoning,
                policy,
                skills,
                nickname: nickname.trim() || undefined,
                avatar,
                emptyContextByDefault,
                discussionAgent,
                roastLevel,
              },
              profileOptions(scope, target, origin ?? undefined),
              requestId,
            ),
          );
        }}
      >
        <fieldset disabled={saving.pending} style={{ display: 'contents' }}>
          <ProfileScopeSelector
            scope={scope}
            onChange={changeScope}
            target={target || undefined}
            active={source?.source}
            origin={origin?.source}
            versions={source?.versions ?? (source ? [source] : [])}
            pending={saving.pending}
            error={saving.error}
          />
          {collision && (
            <p role="alert">
              Cet identifiant existe déjà. Ouvrez le profil existant ou choisissez un nouvel
              identifiant pour créer une copie.
            </p>
          )}
          <div className="agent-identity">
            <Avatar agent={{ ...source, id, name, avatar } as AgentProfile} />
            <label className="field">
              <span>
                Son petit nom <small>facultatif</small>
              </span>
              <input
                maxLength={60}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Ex. Merlin, Ada, Capitaine Patch…"
              />
            </label>
          </div>
          <fieldset className="avatar-picker">
            <legend>Choisissez son personnage</legend>
            {avatarOptions.map((a) => (
              <button
                key={a.id}
                type="button"
                className={avatar === a.id ? 'chosen' : ''}
                aria-label={a.name}
                aria-pressed={avatar === a.id}
                onClick={() => setAvatar(a.id)}
              >
                <AgentImage avatar={a.id} />
                <span>{a.name}</span>
                {avatar === a.id && <Check size={12} />}
              </button>
            ))}
          </fieldset>
          <div className="field-row">
            <label className="field">
              <span>
                Nom du profil <em>*</em>
              </span>
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (blank) setId(slug(e.target.value));
                }}
              />
            </label>
            <label className="field">
              <span>Identifiant</span>
              <input
                required
                pattern="[a-z0-9][a-z0-9-]*"
                value={id}
                disabled={!blank}
                onChange={(e) => setId(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Rôle et description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            <span>
              Instructions <em>*</em>
            </span>
            <textarea
              required
              className="code-input"
              rows={7}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Décrivez sa mission, ses méthodes et les critères d’un travail réussi."
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Outils Studio et outils métier</span>
              <input
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="read, search, edit, execute"
              />
              <small>
                Dans les nouvelles sessions, fichiers et terminal utilisent les outils natifs et les
                permissions Copilot choisies pour la session. Les noms read, search, edit et execute
                configurent les outils Studio historiques. studio_devops_inspect lit les pipelines
                et résultats du dépôt Azure DevOps configuré ; studio_devops_verify_test vérifie le
                test manuel dans une étape exigeant sa preuve. Les permissions de l’étape restent
                applicables à ces outils métier.
              </small>
            </label>
            <ModelSelect
              state={state}
              value={model}
              onChange={(value) => {
                setModel(value);
                setReasoning('');
              }}
            />
          </div>
          <div className="field-row">
            <label className="field">
              <span>Réflexion par défaut de l’agent</span>
              <select value={reasoning} onChange={(e) => setReasoning(e.target.value)}>
                <option value="">Automatique</option>
                {[
                  ...new Set([
                    ...(reasoning ? [reasoning] : []),
                    ...(state.runtime.models.find(
                      (m) => m.id === (model || state.settings.defaultModel),
                    )?.reasoningEfforts ?? []),
                  ]),
                ].map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Permissions par défaut de l’agent</span>
              <select
                value={policy}
                onChange={(e) => setPolicy(e.target.value as NonNullable<AgentProfile['policy']>)}
              >
                <option value="read-only">Lecture seule</option>
                <option value="workspace-write">Écriture dans le projet</option>
                <option value="tests">Tests préautorisés</option>
              </select>
              <small>
                Les outils demandés et les commandes de test autorisées restent nécessaires.
              </small>
            </label>
          </div>
          <label className="discussion-agent-toggle">
            <input
              type="checkbox"
              checked={discussionAgent}
              onChange={(event) => setDiscussionAgent(event.target.checked)}
            />
            <span>
              <strong>Agent de discussion</strong>
              <small>Le proposer en priorité dans le menu Discussion.</small>
            </span>
          </label>
          <label className="field">
            <span>Mode roast</span>
            <select
              aria-label="Mode roast"
              value={roastLevel}
              onChange={(e) => setRoastLevel(e.target.value as RoastLevel)}
            >
              {ROAST_LEVELS.map((level) => (
                <option value={level} key={level}>
                  {roastLabel(level)}
                </option>
              ))}
            </select>
            <small>
              Un ton complice pour ses comptes rendus : les piques visent les choix et le code. Les
              documents du projet restent professionnels. Le niveau est fixé au lancement ; les
              anciens rapports restent tels quels.
            </small>
          </label>
          {roastLevel !== 'off' && (
            <details>
              <summary>Aperçu des consignes roast · {roastLabel(roastLevel)}</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{roastInstructions(roastLevel)}</pre>
            </details>
          )}
          <label className="context-default-option">
            <input
              type="checkbox"
              checked={emptyContextByDefault}
              onChange={(e) => setEmptyContextByDefault(e.target.checked)}
            />
            <span>
              <strong>Contexte vide par défaut</strong>
              <small>
                Tous les blocs optionnels commencent décochés à chaque nouvelle tentative.
                Sélectionnez ensuite la spec, le plan ou les autres informations utiles. Le cadre
                d’exécution reste actif.
              </small>
            </span>
          </label>
          <fieldset className="skill-options">
            <legend>Skills associées</legend>
            {state.skills.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={skills.includes(s.id)}
                  onChange={(e) =>
                    setSkills(
                      e.target.checked ? [...skills, s.id] : skills.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
            {!state.skills.length && (
              <span className="muted">Créez votre première skill depuis la bibliothèque.</span>
            )}
          </fieldset>
          <div className="modal-actions">
            <span className="muted">
              {saving.pending
                ? 'Sauvegarde en cours…'
                : version
                  ? 'Modification de la version choisie.'
                  : 'Création d’une version dans la portée choisie.'}
            </span>
            <button type="button" className="button secondary" onClick={onClose}>
              Annuler
            </button>
            {source?.source === 'workspace' && (
              <button type="button" className="button secondary" onClick={onMigrate}>
                Migrer vers le compte utilisateur
              </button>
            )}
            <button
              className="button primary"
              disabled={saving.pending || collision || !id || !name.trim() || !instructions.trim()}
            >
              Enregistrer le profil <Check size={15} />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
export function SkillEditor({
  skill,
  state,
  onClose,
  onMigrate,
  save,
}: {
  skill: SkillInfo | 'new';
  state: StudioState;
  onClose: () => void;
  onMigrate: () => void;
  save: (id: string, content: string, options: ProfileSaveOptions, requestId: string) => void;
}) {
  const blank = skill === 'new';
  const source = blank ? null : skill;
  const [id, setId] = useState(source?.id ?? '');
  const [content, setContent] = useState(
    source?.content ??
      '---\nname: Ma nouvelle skill\ndescription: Décrivez la méthode et quand l’utiliser.\n---\n\n# Ma nouvelle skill\n\n## Méthode\n\n1. Comprendre le contexte.\n2. Appliquer les conventions du projet.\n3. Vérifier le résultat.\n',
  );
  const [preview, setPreview] = useState(false);
  const [scope, setScope] = useState<ProfileScope>(
    source?.source === 'workspace' ? 'workspace' : 'user',
  );
  const [origin, setOrigin] = useState(source);
  const drafts = useRef<Partial<Record<ProfileScope, { content: string; origin: typeof source }>>>(
    {},
  );
  const saving = useProfileSave(onClose);
  const target =
    source?.targets?.[scope] ??
    (state.profileDirectories && {
      path: `${state.profileDirectories[scope]}/${scope === 'workspace' ? '.github/' : ''}skills/${id}/SKILL.md`,
      revision: null,
    });
  const collision = blank && state.skills.some((entry) => entry.id === id);
  const changeScope = (next: ProfileScope) => {
    drafts.current[scope] = { content, origin };
    const cached = drafts.current[next];
    const existing = source?.versions?.find((version) => version.source === next);
    setContent(cached?.content ?? existing?.content ?? content);
    setOrigin(cached ? cached.origin : (existing ?? origin));
    setScope(next);
  };
  return (
    <Modal
      title={blank ? 'Une méthode qui se transmet.' : (source?.name ?? 'Skill')}
      subtitle={
        source?.path ??
        'Une skill est un fichier Markdown avec une méthode précise et réutilisable.'
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saving.start((requestId) =>
            save(
              id,
              content,
              profileOptions(scope, target || undefined, origin ?? undefined),
              requestId,
            ),
          );
        }}
      >
        <fieldset disabled={saving.pending} style={{ display: 'contents' }}>
          <ProfileScopeSelector
            scope={scope}
            onChange={changeScope}
            target={target || undefined}
            active={source?.source}
            origin={origin?.source}
            versions={source?.versions ?? (source ? [source] : [])}
            pending={saving.pending}
            error={saving.error}
          />
          {collision && (
            <p role="alert">
              Cet identifiant existe déjà. Ouvrez la skill existante ou choisissez un nouvel
              identifiant pour créer une copie.
            </p>
          )}
          <label className="field">
            <span>
              Identifiant de la skill <em>*</em>
            </span>
            <input
              required
              pattern="[a-z0-9][a-z0-9-]*"
              disabled={!blank}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="ex. revue-accessibilite"
            />
            <small>Lettres minuscules, chiffres et tirets.</small>
          </label>
          <div className="section-heading">
            <h3>SKILL.md</h3>
            <button type="button" className="text-button" onClick={() => setPreview(!preview)}>
              <FileText size={14} />
              {preview ? 'Éditer' : 'Aperçu'}
            </button>
          </div>
          {preview ? (
            <div className="skill-preview markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          ) : (
            <label className="field">
              <span className="sr-only">Contenu de la skill</span>
              <textarea
                required
                className="code-input"
                rows={16}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}
          <div className="modal-actions">
            <span className="muted">
              {saving.pending
                ? 'Sauvegarde en cours…'
                : 'Le fichier SKILL.md complet est conservé.'}
            </span>
            <button type="button" className="button secondary" onClick={onClose}>
              Annuler
            </button>
            {source?.source === 'workspace' && (
              <button type="button" className="button secondary" onClick={onMigrate}>
                Migrer vers le compte utilisateur
              </button>
            )}
            <button
              className="button primary"
              disabled={saving.pending || collision || !id || !content.trim()}
            >
              Enregistrer la skill <Check size={15} />
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
