import { CheckCircle2, CircleAlert, LoaderCircle, Info } from 'lucide-react';
import type { DeliveryPreview, DevOpsState } from '../src/shared/devops';

export function DeliveryFeedback({
  state,
  kind,
}: {
  state: DevOpsState;
  kind: DeliveryPreview['kind'];
}) {
  const progress = state.deliveryProgress?.kind === kind ? state.deliveryProgress : undefined;
  const result = state.deliveryResults?.[kind];
  if (!progress && !result) return null;
  const status = progress ? 'running' : result!.status;
  const Icon =
    status === 'running'
      ? LoaderCircle
      : status === 'success'
        ? CheckCircle2
        : status === 'error'
          ? CircleAlert
          : Info;
  return (
    <div className={`delivery-feedback ${status}`} role={status === 'error' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" />
      <div>
        <strong>
          {status === 'running'
            ? 'En cours'
            : status === 'success'
              ? 'C’est fait'
              : status === 'error'
                ? 'Action interrompue'
                : 'Action annulée'}
        </strong>
        <p>{progress?.message ?? result!.message}</p>
      </div>
    </div>
  );
}
