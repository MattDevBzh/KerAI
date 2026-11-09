import { Check, GitCommitHorizontal, GitPullRequest, Upload } from 'lucide-react';
import type { DevOpsState } from '../src/shared/devops';

export function DeliveryStages({ state }: { state: DevOpsState }) {
  const snapshot = state.snapshot;
  const clean = !!snapshot && !snapshot.files.length;
  const push = state.deliveryResults?.push;
  const published =
    push?.status === 'success' && push.head === snapshot?.head && push.branch === snapshot?.branch;
  const steps = [
    {
      id: 'delivery-commit',
      label: 'Commit local',
      icon: GitCommitHorizontal,
      done: clean,
      detail: !snapshot
        ? 'Dépôt à inspecter'
        : clean
          ? 'Aucun fichier en attente'
          : `${snapshot.files.length} fichier(s) à préparer`,
    },
    {
      id: 'delivery-push',
      label: 'Publier la branche',
      icon: Upload,
      done: published,
      detail: published
        ? `Commit ${snapshot?.head.slice(0, 8)} publié`
        : 'Envoyer les commits vers Git',
    },
    {
      id: 'delivery-pr',
      label: 'Pull request',
      icon: GitPullRequest,
      done: !!state.existingPr,
      detail: state.existingPr
        ? `PR #${state.existingPr.id} disponible`
        : 'Rédiger, relire et créer',
    },
  ];
  return (
    <ol className="delivery-stages" aria-label="Progression de la livraison">
      {steps.map((step, index) => (
        <li key={step.id} className={step.done ? 'done' : ''}>
          <a
            href={`#${step.id}`}
            onClick={() => {
              const target = document.getElementById(step.id);
              if (target instanceof HTMLDetailsElement) target.open = true;
            }}
          >
            <span className="delivery-stage-icon">
              {step.done ? (
                <Check size={20} aria-hidden="true" />
              ) : (
                <step.icon size={20} aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>
                <span className="delivery-stage-number">0{index + 1}</span> {step.label}
              </strong>
              <small>{step.detail}</small>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
