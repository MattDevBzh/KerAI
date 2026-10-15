import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  Download,
  FileText,
  FolderInput,
  Layers,
  Link2,
  LoaderCircle,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';
import type { ClientMessage, StudioState } from '../src/shared/types';
import type {
  KitCatalogItem,
  KitClientMessage,
  KitKind,
  KitMetadata,
  KitNode,
  KitPreview,
  KitRef,
} from '../src/shared/kits';
import { kitNodes, resolveKitSelection } from '../src/shared/kits';
import { subscribe } from './bridge';
import './kits.css';
import { AgentImage } from './Avatar';

const kinds: KitKind[] = ['workflow', 'agent', 'skill'];
const labels: Record<KitKind, string> = { workflow: 'Parcours', agent: 'Agents', skill: 'Skills' };
const icons = { workflow: Workflow, agent: Bot, skill: BookOpen };
const bytes = (value: number) => (value < 1024 ? `${value} o` : `${(value / 1024).toFixed(1)} Ko`);
type Action<T = KitClientMessage> = T extends KitClientMessage ? Omit<T, 'requestId'> : never;
function Portrait({ node }: { node: KitNode }) {
  const Icon = icons[node.kind];
  return node.kind === 'agent' && node.avatar ? (
    <AgentImage className="kit-portrait" avatar={node.avatar} agentId={node.id} />
  ) : (
    <span className={`kit-node-icon ${node.kind}`}>
      <Icon size={20} />
    </span>
  );
}
function Counts({ nodes }: { nodes: KitNode[] }) {
  return (
    <div className="kit-counts">
      {kinds.map((kind) => (
        <span key={kind}>
          <strong>{nodes.filter((n) => n.kind === kind).length}</strong>{' '}
          {labels[kind].toLowerCase()}
        </span>
      ))}
    </div>
  );
}
function NodeDetails({ node }: { node: KitNode }) {
  return (
    <details className="kit-node-details">
      <summary>Consulter {node.kind === 'workflow' ? 'le parcours' : 'les instructions'}</summary>
      {node.tools?.length ? <p>Outils : {node.tools.join(', ')}</p> : null}
      <pre>{node.content}</pre>
    </details>
  );
}
export function KitsUI({
  state,
  dispatch,
}: {
  state: StudioState;
  dispatch: (message: ClientMessage) => void;
}) {
  const [catalog, setCatalog] = useState<KitCatalogItem[]>([]);
  const [mode, setMode] = useState<'library' | 'compose' | 'preview'>('library');
  const [origin, setOrigin] = useState<'library' | 'compose'>('library');
  const [preview, setPreview] = useState<KitPreview>();
  const [metadata, setMetadata] = useState<KitMetadata>({
    id: 'mon-kit',
    name: 'Mon kit',
    description: '',
    version: '1.0.0',
  });
  const [roots, setRoots] = useState<KitRef[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<KitKind | 'all'>('all');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const active = useRef('');
  const nodes = useMemo(() => kitNodes(state), [state.agents, state.skills, state.workflows]);
  const selection = useMemo(() => resolveKitSelection(nodes, roots), [nodes, roots]);
  const selected = nodes.filter((n) => selection.refs.includes(n.ref));
  const names = new Map(nodes.map((n) => [n.ref, n.name]));
  const request = (action: Action) => {
    const requestId = crypto.randomUUID();
    active.current = requestId;
    setBusy(true);
    setError('');
    setMessage('');
    dispatch({ ...action, requestId } as KitClientMessage);
  };
  useEffect(() => {
    const off = subscribe((event) => {
      if (event.type !== 'kitResult' || event.requestId !== active.current) return;
      setBusy(false);
      if (event.error) {
        setError(event.error);
        return;
      }
      if (event.catalog) setCatalog(event.catalog);
      if (event.preview) {
        setPreview(event.preview);
        setMode('preview');
      }
      if (event.message) setMessage(event.message);
    });
    request({ type: 'kitCatalog' });
    return off;
  }, []);
  const toggle = (ref: KitRef) => {
    setPreview(undefined);
    setRoots((current) =>
      current.includes(ref) ? current.filter((r) => r !== ref) : [...current, ref],
    );
  };
  const validMeta =
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(metadata.id) &&
    metadata.name.trim() &&
    metadata.version.trim();
  const openPreview = (item: KitCatalogItem) => {
    setOrigin('library');
    request({ type: 'kitPreview', kitId: item.storageId ?? item.metadata.id, source: item.source });
  };
  const editMeta = (key: keyof KitMetadata, value: string) => {
    setMetadata((current) => ({ ...current, [key]: value }));
    setPreview(undefined);
  };
  return (
    <div className="kits-page">
      <div className="kits-heading">
        <div>
          <span className="eyebrow">VOTRE BIBLIOTHÈQUE D’ÉQUIPES</span>
          <h1>
            {mode === 'compose'
              ? 'Composez votre kit.'
              : mode === 'preview'
                ? 'Tout est dans la boîte.'
                : 'Les bonnes équipes, prêtes à partir.'}
          </h1>
          <p>
            {mode === 'compose'
              ? 'Choisissez ce qui vous intéresse. Les dépendances suivent.'
              : mode === 'preview'
                ? 'Relisez le contenu exact avant de l’installer ou de l’exporter.'
                : 'Installez une équipe prête à travailler, ou partagez votre propre façon de faire.'}
          </p>
        </div>
        <div className="kits-heading-actions">
          {mode !== 'library' ? (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setMode(mode === 'preview' ? origin : 'library');
                setError('');
              }}
            >
              <ArrowLeft size={15} />
              Retour
            </button>
          ) : (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setOrigin('library');
                  request({ type: 'kitImport' });
                }}
              >
                <FolderInput size={16} />
                Importer un fichier
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  setMode('compose');
                  setError('');
                  setMessage('');
                }}
              >
                <Plus size={16} />
                Créer un kit
              </button>
            </>
          )}
        </div>
      </div>
      {busy && (
        <p className="kit-status" role="status">
          <LoaderCircle className="spin" size={15} /> Préparation du kit…
        </p>
      )}
      {error && (
        <div className="kit-error" role="alert">
          {error}
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => request({ type: 'kitCatalog' })}
          >
            Actualiser la bibliothèque
          </button>
        </div>
      )}
      {message && (
        <p className="kit-success" role="status">
          <CheckCircle2 size={17} />
          {message}
        </p>
      )}
      {mode === 'library' && (
        <>
          <div className="kit-library-intro">
            <Package size={19} />
            <h2>Kits prédéfinis</h2>
            <span>Fournis avec Feature Studio</span>
          </div>
          <div className="kit-cards">
            {catalog
              .filter((k) => k.source === 'bundled')
              .map((item) => (
                <article
                  className={`kit-card ${item.metadata.id === 'devops' ? 'devops' : 'copilot'}`}
                  key={item.metadata.id}
                >
                  <div className="kit-card-cover">
                    <span className="kit-card-tag">
                      {item.metadata.id === 'devops'
                        ? 'INFRASTRUCTURE & CI/CD'
                        : 'CONCEPTION & DÉVELOPPEMENT'}
                    </span>
                    <div className="kit-team">
                      {item.nodes
                        .filter((n) => n.kind === 'agent' && n.avatar)
                        .slice(0, 6)
                        .map((n) => (
                          <div key={n.ref} title={n.name}>
                            <Portrait node={n} />
                          </div>
                        ))}
                    </div>
                    <div className="kit-cover-line">
                      <span />
                      <Layers size={18} />
                      <span />
                    </div>
                  </div>
                  <div className="kit-card-body">
                    <div className="kit-title-row">
                      <h2>{item.metadata.name}</h2>
                      <span className={`kit-pill ${item.installed ? 'installed' : ''}`}>
                        {item.installed ? 'Installé' : 'Prêt à installer'}
                      </span>
                    </div>
                    <p>{item.metadata.description}</p>
                    <Counts nodes={item.nodes} />
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => openPreview(item)}
                    >
                      Voir le kit <ArrowRight size={15} />
                    </button>
                  </div>
                </article>
              ))}
          </div>
          <div className="kit-create-banner">
            <span className="kit-node-icon">
              <Package size={25} />
            </span>
            <div>
              <h2>Votre méthode mérite son kit.</h2>
              <p>
                Un parcours complet, une équipe choisie ou quelques skills. Emportez les ressources
                qui vont avec.
              </p>
            </div>
            <button className="button secondary" disabled={busy} onClick={() => setMode('compose')}>
              Composer mon kit <Plus size={15} />
            </button>
          </div>
          {catalog.some((k) => k.source === 'saved') && (
            <section>
              <div className="kit-library-intro">
                <Layers size={18} />
                <h2>Mes kits enregistrés</h2>
              </div>
              <div className="kit-saved-list">
                {catalog
                  .filter((k) => k.source === 'saved')
                  .map((item) => (
                    <button
                      className="kit-saved"
                      key={item.storageId ?? item.metadata.id}
                      disabled={busy || !!item.error}
                      onClick={() => openPreview(item)}
                    >
                      <Package size={21} />
                      <span>
                        <strong>{item.metadata.name}</strong>
                        <small>
                          {item.metadata.version} · {item.error ?? `${item.nodes.length} éléments`}
                        </small>
                      </span>
                      <span>
                        {item.error ? 'À réparer' : item.installed ? 'Installé' : 'Consulter'}
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
              </div>
            </section>
          )}
          <p className="kit-footnote">
            <ShieldCheck size={16} /> L’installation conserve vos fichiers existants et présente les
            conflits. Le format local est .fskit.json.
          </p>
        </>
      )}
      {mode === 'compose' && (
        <div className="kit-composer">
          <section className="kit-pick-area">
            <div className="kit-composer-intro">
              <span className="kit-step-number">01</span>
              <div>
                <h2>Choisissez les pièces</h2>
                <p>Parcours → agents → skills → ressources incluses à l’export.</p>
              </div>
            </div>
            <div className="kit-filter-row">
              <label className="kit-search">
                <Search size={16} />
                <input
                  aria-label="Rechercher dans les éléments du kit"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un parcours, un agent…"
                />
              </label>
              <div className="kit-filters" role="group" aria-label="Type d’éléments">
                {(['all', ...kinds] as const).map((kind) => (
                  <button key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>
                    {kind === 'all' ? 'Tout' : labels[kind]}
                  </button>
                ))}
              </div>
            </div>
            <div className="kit-picker-groups">
              {kinds
                .filter((k) => filter === 'all' || filter === k)
                .map((kind) => (
                  <section className={`kit-picker-group ${kind}`} key={kind}>
                    <h3>
                      {labels[kind]}
                      <span>{nodes.filter((n) => n.kind === kind).length}</span>
                    </h3>
                    {nodes
                      .filter(
                        (n) =>
                          n.kind === kind &&
                          `${n.name} ${n.description}`
                            .toLocaleLowerCase()
                            .includes(search.toLocaleLowerCase()),
                      )
                      .map((node) => {
                        const direct = roots.includes(node.ref),
                          included = selection.refs.includes(node.ref),
                          auto = included && !direct;
                        return (
                          <article
                            key={node.ref}
                            className={`kit-select-card ${included ? 'included' : ''} ${auto ? 'automatic' : ''}`}
                          >
                            <label>
                              <input
                                type="checkbox"
                                aria-label={`Inclure ${node.name}`}
                                checked={included}
                                disabled={busy || auto}
                                onChange={() => toggle(node.ref)}
                              />
                              <Portrait node={node} />
                              <span>
                                <strong>{node.name}</strong>
                                <small>{node.description}</small>
                              </span>
                            </label>
                            {auto ? (
                              <p className="kit-dependency">
                                <Link2 size={12} />
                                Requis par{' '}
                                {(selection.reasons[node.ref] ?? [])
                                  .map((r) => names.get(r) ?? r)
                                  .join(', ')}
                              </p>
                            ) : direct ? (
                              <p className="kit-direct">
                                <Check size={12} />
                                Votre sélection
                              </p>
                            ) : null}
                            <NodeDetails node={node} />
                          </article>
                        );
                      })}
                  </section>
                ))}
            </div>
          </section>
          <aside className="kit-basket" aria-label="Contenu de votre kit">
            <div className="kit-composer-intro">
              <span className="kit-step-number">02</span>
              <div>
                <h2>Votre kit</h2>
                <p>
                  {roots.length} choix · {selected.length - roots.length} dépendances ajoutées
                </p>
              </div>
            </div>
            <Counts nodes={selected} />
            <div className="kit-basket-roots">
              {!roots.length ? (
                <p>Choisissez un élément pour commencer.</p>
              ) : (
                roots.map((ref) => (
                  <div key={ref}>
                    <span>{names.get(ref) ?? ref}</span>
                    <button
                      className="icon-button"
                      aria-label={`Retirer ${names.get(ref) ?? ref}`}
                      disabled={busy}
                      onClick={() => toggle(ref)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <label>
              Nom du kit
              <input
                maxLength={120}
                disabled={busy}
                value={metadata.name}
                onChange={(e) => editMeta('name', e.target.value)}
              />
            </label>
            <div className="kit-meta-grid">
              <label>
                Identifiant
                <input
                  maxLength={80}
                  disabled={busy}
                  value={metadata.id}
                  onChange={(e) => editMeta('id', e.target.value)}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*"
                />
              </label>
              <label>
                Version
                <input
                  maxLength={40}
                  disabled={busy}
                  value={metadata.version}
                  onChange={(e) => editMeta('version', e.target.value)}
                />
              </label>
            </div>
            <label>
              Description
              <textarea
                rows={3}
                maxLength={1000}
                disabled={busy}
                value={metadata.description}
                onChange={(e) => editMeta('description', e.target.value)}
              />
            </label>
            {!validMeta && (
              <p className="kit-error">
                Renseignez un nom, une version et un identifiant sans espace.
              </p>
            )}
            {selection.errors.map((e) => (
              <p className="kit-error" key={e}>
                {e}
              </p>
            ))}
            <button
              className="button primary"
              disabled={busy || !roots.length || !validMeta || !!selection.errors.length}
              onClick={() => {
                setOrigin('compose');
                request({ type: 'kitCompose', metadata, roots });
              }}
            >
              Préparer l’export <ArrowRight size={16} />
            </button>
            <p className="kit-footnote">
              Le prochain écran détaille aussi les scripts, références et licences embarqués.
            </p>
          </aside>
        </div>
      )}
      {mode === 'preview' && preview && (
        <div className="kit-preview-layout">
          <section className="kit-manifest">
            <div className="kit-library-intro">
              <Package size={22} />
              <h2>{preview.metadata.name}</h2>
              <span>v{preview.metadata.version}</span>
            </div>
            <p>{preview.metadata.description}</p>
            <Counts nodes={preview.nodes} />
            <div className="kit-preview-nodes">
              {preview.nodes.map((node) => (
                <article key={node.ref}>
                  <div className="kit-preview-node-heading">
                    <Portrait node={node} />
                    <div>
                      <strong>{node.name}</strong>
                      <small>
                        {labels[node.kind]} ·{' '}
                        {preview.roots.includes(node.ref) ? 'Sélectionné' : 'Dépendance'}
                      </small>
                    </div>
                  </div>
                  <p>{node.description}</p>
                  <NodeDetails node={node} />
                </article>
              ))}
            </div>
          </section>
          <aside className="kit-basket">
            <span className="eyebrow">PRÊT À EMPORTER</span>
            <h2>
              {preview.files.length} fichiers · {bytes(preview.bytes)}
            </h2>
            <p>Destination d’installation : votre catalogue utilisateur Copilot.</p>
            <div className="kit-install-counts">
              {(['new', 'identical', 'conflict'] as const).map((status) => (
                <span key={status} className={status}>
                  <strong>{preview.files.filter((f) => f.status === status).length}</strong>{' '}
                  {status === 'new'
                    ? 'nouveaux'
                    : status === 'identical'
                      ? 'identiques'
                      : 'conflits'}
                </span>
              ))}
            </div>
            <button
              className="button primary"
              disabled={busy || !preview.canInstall}
              onClick={() => request({ type: 'kitInstall', token: preview.token })}
            >
              <Download size={16} />
              Installer ce kit
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => request({ type: 'kitExport', token: preview.token })}
            >
              <Package size={16} />
              Exporter le fichier
            </button>
            {preview.warnings.map((w) => (
              <p key={w} className="kit-footnote">
                {w}
              </p>
            ))}
            <details className="kit-files">
              <summary>
                <FileText size={14} />
                Voir tous les fichiers
              </summary>
              <ul>
                {preview.files.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code>
                    <small className={file.status}>
                      {bytes(file.bytes)} ·{' '}
                      {file.status === 'new'
                        ? 'nouveau'
                        : file.status === 'identical'
                          ? 'identique'
                          : 'conflit'}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          </aside>
        </div>
      )}
    </div>
  );
}
