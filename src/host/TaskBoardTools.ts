import type { Tool } from '@github/copilot-sdk';
import { taskBoardUpdateSchema } from '../core/taskBoard';
import type { RunCallbacks } from '../shared/types';

export function taskBoardTools(
  callbacks: RunCallbacks,
  signal: AbortSignal,
  sanitize: (text: string) => string = (text) => text,
): Tool[] {
  if (!callbacks.onTaskBoard) return [];
  return [
    {
      name: 'studio_update_task_board',
      description:
        'Publie ta checklist complète sur le tableau du QG : plan initial et avancement, ou une seule tâche courante sans plan. Une ligne par étape du plan ou fonctionnalité à tester. Renvoie les lignes avec leur statut à jour, une seule in_progress au maximum. Garde les identifiants ; done signifie réalisé par toi, jamais validé par l’humain. Aucune écriture dans le dépôt.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['plan', 'task'] },
          title: { type: 'string', minLength: 1, maxLength: 100 },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 48,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
                text: { type: 'string', minLength: 1, maxLength: 180 },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'] },
                note: { type: 'string', maxLength: 300 },
              },
              required: ['id', 'text', 'status'],
            },
          },
        },
        required: ['mode', 'title', 'items'],
      },
      skipPermission: true,
      defer: 'never',
      handler: async (raw, invocation) => {
        if (signal.aborted || invocation.signal?.aborted) throw new Error('Tentative annulée.');
        const update = taskBoardUpdateSchema.parse(raw);
        const board = await callbacks.onTaskBoard!({
          ...update,
          title: sanitize(update.title),
          items: update.items.map((i) => ({
            ...i,
            text: sanitize(i.text),
            ...(i.note ? { note: sanitize(i.note) } : {}),
          })),
        });
        return {
          resultType: 'success',
          textResultForLlm: JSON.stringify({
            revision: board.revision,
            items: board.items,
            initialPlan: board.initialPlan,
          }),
        };
      },
    },
  ];
}
