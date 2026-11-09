import { ZodError } from 'zod';
import { redact } from './process';

export class AzureDevOpsHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AzureDevOpsHttpError';
  }
  get rejectedWrite() {
    return [400, 401, 403, 404, 405, 409, 422, 429].includes(this.status);
  }
}

/** Keep diagnostics readable without forwarding raw schema dumps or credentials. */
export function devOpsErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const fields = [...new Set(error.issues.map((issue) => issue.path.join('.')).filter(Boolean))];
    return `Les données reçues ne correspondent pas au format attendu${fields.length ? ` (${fields.slice(0, 4).join(', ')})` : ''}. Actualise les informations puis réessaie. Si le problème persiste, conserve ce message pour le diagnostic.`;
  }
  return redact(
    error instanceof Error && error.message.trim()
      ? error.message
      : 'L’opération a échoué sans précision. Réessaie après avoir actualisé les informations.',
  );
}
