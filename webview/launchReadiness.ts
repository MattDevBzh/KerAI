import type { ApplicationProfile } from '../src/shared/navigation';
import type { Feature, FeatureStep, RunLaunchOptions, StudioState } from '../src/shared/types';
import type { SessionStarterId } from '../src/shared/sessionStarters';

export function initialSessionStarter(
  state: StudioState,
  saved?: SessionStarterId,
): SessionStarterId {
  if (saved === 'custom' || state.workflows.some((workflow) => workflow.id === saved))
    return saved!;
  return state.workflows.some((workflow) => workflow.id === 'feature') ? 'feature' : 'custom';
}
export function applicationReadiness(state: StudioState, application: ApplicationProfile) {
  const issues: string[] = [];
  try {
    const url = new URL(application.startUrl ?? application.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
  } catch {
    issues.push('Renseignez une adresse HTTP ou HTTPS sans identifiants dans le profil.');
  }
  const active =
    state.projectCatalog?.activeProjectId ??
    state.projectCatalog?.projects.find((project) => project.path === state.workspace.path)?.id;
  if (!application.projectIds.length) issues.push('Associez au moins un dépôt dans le profil.');
  if (active && !application.projectIds.includes(active))
    issues.push('Ajoutez le projet actif au profil ou ouvrez un de ses projets.');
  const navigator = state.agents.find((agent) => agent.id === application.ownerNavigatorId);
  if (!navigator?.tools.includes('navigation'))
    issues.push(
      'Choisissez un agent doté de la capacité navigation dans le profil pour décrire ou entretenir les parcours.',
    );
  return issues;
}
export type LaunchIssue = {
  message: string;
  action?: 'manageWorkspaceTrust' | 'checkRuntime' | 'openSettings';
};
export function launchReadiness(
  state: StudioState,
  feature: Feature,
  step: FeatureStep,
  launch: RunLaunchOptions,
): LaunchIssue[] {
  const issues: LaunchIssue[] = [];
  const agent = state.agents.find((item) => item.id === step.agentId);
  if (!agent)
    issues.push({
      message:
        'Cet agent est indisponible. Choisissez un agent présent dans le projet depuis l’équipe de la session.',
    });
  if (!state.workspace.trusted)
    issues.push({
      message: 'Le projet doit être approuvé dans VS Code.',
      action: 'manageWorkspaceTrust',
    });
  if (state.runtime.state !== 'ready')
    issues.push({
      message: state.runtime.error ?? 'La connexion Copilot doit être vérifiée.',
      action: 'checkRuntime',
    });
  if (feature.execution && state.runtime.native?.available === false)
    issues.push({
      message: state.runtime.native.error ?? 'Les outils natifs Copilot sont indisponibles.',
      action: 'checkRuntime',
    });
  if (
    feature.execution &&
    state.runtime.native?.available &&
    !state.runtime.native.permissionModes.includes(launch.permissionMode ?? 'manual')
  )
    issues.push({
      message:
        'Le mode de permissions sélectionné est indisponible. Choisissez un mode disponible dans Permissions Copilot.',
    });
  if (feature.archived)
    issues.push({
      message: 'Cette session est archivée. Restaurez-la avant de lancer une tentative.',
    });
  if (state.features.some((item) => item.steps.some((candidate) => candidate.status === 'running')))
    issues.push({
      message: 'Une autre étape travaille encore. Attendez sa fin ou arrêtez-la avant de relancer.',
    });
  if (state.workspaceOperation)
    issues.push({
      message: `${state.workspaceOperation.label} : attendez la fin de cette opération.`,
    });
  if (step.maxAttempts !== 0 && step.attempts.length >= step.maxAttempts)
    issues.push({
      message:
        'La limite de tentatives est atteinte. Ajustez la limite de cette étape avant une nouvelle tentative.',
    });
  if (launch.navigation && agent && !agent.tools.includes('navigation'))
    issues.push({
      message:
        'Cet agent ne possède pas la capacité navigation. Retirez ce contexte ou choisissez un agent compatible dans l’équipe.',
    });
  return issues;
}

/** Mirrors the adapter's restricted native catalogue; runtime still validates the final catalogue. */
export function restrictedNativeTools(
  state: StudioState,
  feature: Feature,
  step: FeatureStep,
  launch: RunLaunchOptions,
) {
  const agent = state.agents.find((item) => item.id === step.agentId);
  const application = state.navigation?.applications.find(
    (item) => item.id === launch.navigation?.applicationId,
  );
  const owner = Boolean(application && application.ownerNavigatorId === agent?.id);
  const readOnly = Boolean(
    launch.pair ||
      agent?.tools.includes('documentation') ||
      (launch.navigation && (step.policy === 'read-only' || owner)),
  );
  return {
    readOnly,
    owner,
    tools: feature.execution
      ? (state.runtime.native?.tools ?? []).filter(
          (tool) => !readOnly || ['view', 'glob', 'grep', 'rg', 'ask_user'].includes(tool),
        )
      : [],
  };
}
