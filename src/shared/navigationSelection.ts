import type { AgentProfile } from './types';
import type { NavigationSnapshot, NavigationSelection } from './navigation';

export function isNavigator(agent: AgentProfile, data?: NavigationSnapshot): boolean {
  return (
    agent.id === 'fs-navigator' ||
    agent.skills.includes('navigation-discovery') ||
    Boolean(
      agent.policy === 'read-only' &&
        agent.tools.includes('navigation') &&
        data?.applications.some((app) => app.ownerNavigatorId === agent.id),
    )
  );
}

/** Only infer an unambiguous application explicitly assigned to this agent and these projects. */
export function defaultNavigationSelection(
  agent: AgentProfile | undefined,
  data: NavigationSnapshot | undefined,
  projectIds: string[],
): NavigationSelection | undefined {
  if (!agent?.tools.includes('navigation') || !data || !isNavigator(agent, data)) return;
  const applications = data.applications.filter(
    (app) =>
      app.ownerNavigatorId === agent.id && app.projectIds.every((id) => projectIds.includes(id)),
  );
  if (applications.length !== 1) return;
  return {
    applicationId: applications[0].id,
    parameters: {},
    intent: 'reach-state',
    allowInteractions: false,
  };
}
