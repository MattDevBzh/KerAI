import { useEffect, useState } from 'react';
import {
  BarChart3,
  ChartNoAxesCombined,
  BookOpen,
  Bot,
  BrainCircuit,
  ChevronDown,
  FileCheck2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  MessageSquare,
  Package,
  PanelsTopLeft,
  Settings,
  Tickets,
  Trophy,
  Workflow,
  Zap,
} from 'lucide-react';
import { searchText } from './Ergonomics';

export const navigationScreens = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'sessions', label: 'Sessions', icon: PanelsTopLeft },
  { id: 'stats', label: 'Stats', icon: ChartNoAxesCombined },
  { id: 'discussion', label: 'Discussion', icon: MessageSquare },
  { id: 'validation', label: 'Validation', icon: FileCheck2 },
  { id: 'workflows', label: 'Mes équipes', icon: Workflow },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'kits', label: 'Kits', icon: Package },
  { id: 'usage', label: 'Consommation', icon: BarChart3 },
  { id: 'devops', label: 'Azure DevOps', icon: FolderGit2 },
  { id: 'devops-tickets', label: 'Tickets', icon: Tickets },
  { id: 'devops-prs', label: 'PR', icon: GitPullRequest },
  { id: 'delivery', label: 'Livraison', icon: GitBranch },
  { id: 'automations', label: 'Automatisations', icon: Zap },
  { id: 'memory', label: 'Mémoire', icon: BrainCircuit },
  { id: 'quests', label: 'Quêtes', icon: Trophy },
  { id: 'settings', label: 'Réglages', icon: Settings },
] as const;

export type View = (typeof navigationScreens)[number]['id'];

const navigationGroups = [
  {
    id: 'atelier',
    label: 'Atelier',
    description: 'Équipes, agents, skills, kits et consommation des sessions',
    icon: PanelsTopLeft,
    views: ['workflows', 'agents', 'skills', 'kits', 'usage'] as readonly View[],
  },
  {
    id: 'devops',
    label: 'DevOps',
    description: 'Azure DevOps, tickets, pull requests et livraison',
    icon: FolderGit2,
    views: ['devops', 'devops-tickets', 'devops-prs', 'delivery'] as readonly View[],
  },
] as const;

export function navigationGroup(view: View) {
  return navigationGroups.find((group) => group.views.includes(view));
}

export function StudioNavigation({
  view,
  query,
  onNavigate,
  sessionCount,
  validationCount,
  trophies,
}: {
  view: View;
  query: string;
  onNavigate: (view: View) => void;
  sessionCount: number;
  validationCount: number;
  trophies?: number;
}) {
  const [expanded, setExpanded] = useState<string | undefined>(() => navigationGroup(view)?.id);
  useEffect(() => setExpanded(navigationGroup(view)?.id), [view]);

  const renderScreen = (id: View, nested = false) => {
    const screen = navigationScreens.find((item) => item.id === id)!;
    return (
      <button
        key={screen.id}
        className={`nav-item ${nested ? 'nav-child' : ''} ${view === screen.id ? 'active' : ''}`}
        title={screen.label}
        onClick={() => onNavigate(screen.id)}
        aria-label={screen.label}
        aria-current={view === screen.id ? 'page' : undefined}
      >
        <screen.icon size={nested ? 16 : 18} aria-hidden="true" />
        <span>{screen.label}</span>
        {screen.id === 'quests' && (
          <small className="quest-menu-count" title="Trophées remportés">
            {trophies ?? '—'}
          </small>
        )}
        {screen.id === 'sessions' && sessionCount > 0 && <small>{sessionCount}</small>}
        {screen.id === 'validation' && validationCount > 0 && <small>{validationCount}</small>}
      </button>
    );
  };
  const search = searchText(query);
  const matches = navigationScreens.filter((screen) =>
    searchText(`${screen.label} ${navigationGroup(screen.id)?.label ?? ''}`).includes(search),
  );
  return (
    <nav aria-label="Navigation principale">
      {search ? (
        matches.length ? (
          matches.map((screen) => renderScreen(screen.id))
        ) : (
          <p className="muted navigation-empty" role="status">
            Aucun écran. Essayez un autre mot.
          </p>
        )
      ) : (
        <>
          {(['dashboard', 'sessions', 'stats', 'discussion', 'validation'] as const).map((id) =>
            renderScreen(id),
          )}
          <div className="nav-groups">
            {navigationGroups.map((group) => {
              const current = group.views.includes(view);
              const open = expanded === group.id;
              return (
                <div className="nav-group" key={group.id}>
                  <button
                    className={`nav-item nav-group-toggle ${current ? 'is-current' : ''}`}
                    title={group.description}
                    aria-label={group.label}
                    aria-expanded={open}
                    aria-controls={`nav-group-${group.id}`}
                    onClick={() => setExpanded(open ? undefined : group.id)}
                  >
                    <group.icon size={18} aria-hidden="true" />
                    <span>{group.label}</span>
                    <ChevronDown className="nav-group-chevron" size={14} aria-hidden="true" />
                  </button>
                  <div className="nav-group-pages" id={`nav-group-${group.id}`} hidden={!open}>
                    {group.views.map((id) => renderScreen(id, true))}
                  </div>
                </div>
              );
            })}
          </div>
          {(['automations', 'memory', 'quests'] as const).map((id) => renderScreen(id))}
        </>
      )}
    </nav>
  );
}
