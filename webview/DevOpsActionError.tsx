import type { DevOpsClientMessage, DevOpsState } from '../src/shared/devops';

export function DevOpsActionError({
  state,
  actions,
}: {
  state: DevOpsState;
  actions: DevOpsClientMessage['type'][];
}) {
  if (!state.error || !state.errorAction || !actions.includes(state.errorAction)) return null;
  return (
    <p className="devops-error" role="alert">
      {state.error}
    </p>
  );
}
