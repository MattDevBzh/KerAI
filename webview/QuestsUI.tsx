import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  Flag,
  LockKeyhole,
  Search,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  quests,
  questById,
  questStatus,
  type QuestCategory,
  type QuestDestination,
  type QuestState,
} from '../src/shared/quests';
import { isDemo, send } from './bridge';
import './quests.css';
const categories: QuestCategory[] = [
  'Premiers pas',
  'Composition',
  'Collaboration',
  'Maîtrise',
  'Exploration',
];
const icons = {
  'Premiers pas': Flag,
  Composition: Users,
  Collaboration: Sparkles,
  Maîtrise: BookOpen,
  Exploration: Compass,
};
const destinations: Record<QuestDestination, string> = {
  dashboard: 'Voir mes sessions',
  agents: 'Ouvrir les agents',
  skills: 'Ouvrir les skills',
  workflows: 'Ouvrir les parcours',
  memory: 'Ouvrir la mémoire',
  discussion: 'Ouvrir les discussions',
  settings: 'Ouvrir les réglages',
  kits: 'Ouvrir les kits',
};
export function QuestCelebration({
  ids,
  onClose,
  onOpen,
}: {
  ids: string[];
  onClose: () => void;
  onOpen: () => void;
}) {
  const earned = ids.map((id) => questById.get(id)).filter((q) => q !== undefined);
  if (!earned.length) return null;
  const reward = earned.reduce((sum, q) => sum + q.reward, 0);
  return (
    <div className="quest-celebration" role="status" aria-live="polite">
      <Trophy size={22} aria-hidden="true" />
      <div>
        <strong>
          {earned.length === 1 ? earned[0].title : `${earned.length} quêtes accomplies`}
        </strong>
        <span>
          +{reward} trophée{reward > 1 ? 's' : ''} ·{' '}
          {earned.length === 1 ? 'Quête accomplie !' : 'Votre carnet progresse.'}
        </span>
      </div>
      <button className="text-button" onClick={onOpen}>
        Voir les quêtes <ArrowRight size={14} />
      </button>
      <button className="icon-button" aria-label="Fermer la récompense" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
export function QuestsUI({
  state,
  navigate,
}: {
  state?: QuestState;
  navigate: (view: QuestDestination) => void;
}) {
  const [tab, setTab] = useState<'active' | 'completed' | 'all'>('active');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(12);
  if (!state)
    return (
      <div className="page quests-page">
        <h1>Votre carnet de quêtes</h1>
        <p role="status">Chargement de votre progression…</p>
        <button className="button secondary" onClick={() => send({ type: 'refreshQuests' })}>
          Actualiser la progression
        </button>
      </div>
    );
  if (state.error)
    return (
      <div className="page quests-page">
        <h1>Votre carnet de quêtes</h1>
        <p className="quest-error" role="alert">
          {state.error}
        </p>
        <button className="button secondary" onClick={() => send({ type: 'refreshQuests' })}>
          Relire la progression
        </button>
      </div>
    );
  const done = quests.filter((q) => state.completed[q.id]).length;
  const active = quests.filter((q) => questStatus(q, state) === 'active').length;
  const selected = quests.filter(
    (q) =>
      (tab === 'all' || questStatus(q, state) === tab) &&
      (category === 'all' || q.category === category) &&
      `${q.title} ${q.description} ${q.help}`
        .toLocaleLowerCase('fr')
        .includes(search.toLocaleLowerCase('fr')),
  );
  const updateTab = (value: typeof tab) => {
    setTab(value);
    setLimit(12);
  };
  return (
    <div className="page quests-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            <span />
            LE CARNET DES QUÊTES
          </span>
          <h1>
            Apprendre en jouant.
            <br />
            <span className="serif accent-text">Avancer à votre rythme.</span>
          </h1>
          <p>
            Des petits déclics aux grands relais : explorez tout ce que votre atelier sait faire.
          </p>
        </div>
      </div>
      <section className="quest-overview" aria-label="Votre progression">
        <div className="quest-trophy">
          <span className="quest-medal">
            <Trophy size={38} strokeWidth={1.4} aria-hidden="true" />
          </span>
          <div>
            <strong>{state.trophies.toLocaleString('fr-FR')}</strong>
            <span>trophées remportés</span>
          </div>
        </div>
        <div className="quest-overview-progress">
          <div>
            <strong>
              {done} / {quests.length}
            </strong>
            <span>quêtes accomplies</span>
          </div>
          <progress max={quests.length} value={done} aria-label="Quêtes accomplies" />
          <p>Chaque quête rapporte de 1 à 10 trophées. Les bonus viendront plus tard.</p>
        </div>
        <div className="quest-overview-note">
          <Sparkles size={22} />
          <strong>Une étape après l’autre</strong>
          <p>
            Une quête de série terminée dévoile la suivante. Les défis uniques restent dans votre
            collection.
          </p>
        </div>
      </section>
      {isDemo && (
        <p className="muted quest-demo">
          Démonstration : les quêtes sont consultables, aucune récompense personnelle n’est
          enregistrée.
        </p>
      )}
      <div className="quest-toolbar">
        <div className="quest-tabs" role="group" aria-label="Quêtes affichées">
          <button aria-pressed={tab === 'active'} onClick={() => updateTab('active')}>
            À jouer <span>{active}</span>
          </button>
          <button aria-pressed={tab === 'completed'} onClick={() => updateTab('completed')}>
            Accomplies <span>{done}</span>
          </button>
          <button aria-pressed={tab === 'all'} onClick={() => updateTab('all')}>
            Collection <span>{quests.length}</span>
          </button>
        </div>
        <label className="quest-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Rechercher une quête"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(12);
            }}
            placeholder="Un agent, un relais, une skill…"
          />
        </label>
      </div>
      <div className="quest-categories" role="group" aria-label="Familles de quêtes">
        {['all', ...categories].map((value) => (
          <button
            key={value}
            aria-pressed={category === value}
            onClick={() => {
              setCategory(value);
              setLimit(12);
            }}
          >
            {value === 'all' ? 'Toutes les familles' : value}
          </button>
        ))}
      </div>
      <p className="quest-results" role="status">
        {selected.length} quête{selected.length > 1 ? 's' : ''}{' '}
        {tab === 'active'
          ? 'à jouer'
          : tab === 'completed'
            ? 'accomplie' + (selected.length > 1 ? 's' : '')
            : 'dans cette sélection'}
      </p>
      <div className="quest-grid">
        {selected.slice(0, limit).map((quest) => {
          const status = questStatus(quest, state),
            Icon = icons[quest.category];
          const count = Math.min(state.counts[quest.metric] ?? 0, quest.target);
          return (
            <article className={`quest-card ${status}`} key={quest.id} data-quest-id={quest.id}>
              <div className="quest-card-top">
                <span className="quest-icon">
                  <Icon size={22} />
                </span>
                <span className="quest-reward">
                  <Trophy size={14} />
                  {quest.reward}
                </span>
              </div>
              <div className="quest-card-label">
                {quest.category}
                <span>·</span>
                {quest.series ? `Série ${quest.tier}/5` : 'Unique'}
              </div>
              <h2>{quest.title}</h2>
              <p className="quest-description">{quest.description}</p>
              <div className="quest-card-progress">
                <progress
                  max={quest.target}
                  value={count}
                  aria-label={`Progression : ${quest.title}`}
                />
                <span>
                  {count}/{quest.target}
                </span>
              </div>
              {status === 'locked' && (
                <p className="quest-lock">
                  <LockKeyhole size={12} />
                  Après « {questById.get(quest.previousId!)?.title} »
                </p>
              )}
              <details className="quest-help">
                <summary>Comment la réussir</summary>
                <p>{quest.help}</p>
              </details>
              <div className="quest-card-bottom">
                {status === 'completed' ? (
                  <span className="quest-completed">
                    <Check size={15} />
                    Accomplie ·{' '}
                    {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(
                      new Date(state.completed[quest.id].at),
                    )}
                  </span>
                ) : (
                  <button
                    className="text-button"
                    disabled={status === 'locked'}
                    onClick={() => navigate(quest.destination)}
                  >
                    {destinations[quest.destination]}
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!selected.length && (
        <div className="quest-empty">
          <Compass size={34} />
          <h2>
            {tab === 'completed'
              ? 'Le premier trophée vous attend'
              : 'Aucune quête dans cette sélection'}
          </h2>
          <p>
            {tab === 'completed'
              ? 'Lancez une feature, créez votre premier agent ou choisissez une ambiance.'
              : 'Essayez une autre famille ou une autre recherche.'}
          </p>
          {tab === 'completed' && (
            <button className="button secondary" onClick={() => updateTab('active')}>
              Découvrir les quêtes
            </button>
          )}
        </div>
      )}
      {selected.length > limit && (
        <button
          className="button secondary quest-more"
          onClick={() => setLimit((value) => value + 12)}
        >
          Voir 12 quêtes de plus <ArrowRight size={15} />
        </button>
      )}
      <p className="quest-footnote">
        Progression personnelle enregistrée sur cet ordinateur, commune à vos projets. Chaque
        récompense est attribuée une seule fois. Les sessions présentes peuvent déjà vous faire
        avancer.
      </p>
    </div>
  );
}
