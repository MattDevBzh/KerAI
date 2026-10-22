import { randomUUID } from 'node:crypto';
import type { Tool } from '@github/copilot-sdk';
import { proofProposalSchema } from '../core/proofSchemas';
import type { RunCallbacks } from '../shared/types';
export function proofTools(callbacks: RunCallbacks, signal: AbortSignal): Tool[] {
  if (!callbacks.getProofs || !callbacks.onProofClaim) return [];
  return [
    {
      name: 'studio_list_proofs',
      description:
        'Liste les preuves réellement conservées dans cette session : identifiants, provenance, extraits et état. Une source observée ne prouve pas automatiquement une affirmation.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        if (signal.aborted) throw Error('Tentative annulée.');
        const sources = callbacks.getProofs!();
        return {
          resultType: 'success',
          textResultForLlm: JSON.stringify({
            total: sources.length,
            omitted: Math.max(0, sources.length - 150),
            sources: sources.slice(-150).map(({ image: _image, content, ...source }) => ({
              ...source,
              content: content.slice(0, 3000),
              excerptTruncated: content.length > 3000,
            })),
          }),
        };
      },
    },
    {
      name: 'studio_propose_claim',
      description:
        'Conserve une conclusion argumentée liée à des identifiants retournés par studio_list_proofs. supported/contradicted/unverified sont ton appréciation, jamais une validation humaine. Ne cite pas un simple succès de commande comme preuve métier.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          proofIds: { type: 'array', items: { type: 'string' } },
          verdict: { type: 'string', enum: ['supported', 'contradicted', 'unverified'] },
        },
        required: ['text', 'proofIds', 'verdict'],
        additionalProperties: false,
      },
      handler: async (value) => {
        if (signal.aborted) throw Error('Tentative annulée.');
        const proposal = proofProposalSchema.parse(value);
        const claim = await callbacks.onProofClaim!({ ...proposal, id: randomUUID() });
        return {
          resultType: 'success',
          textResultForLlm: JSON.stringify({
            id: claim.id,
            status: 'proposition conservée, pas une validation humaine',
          }),
        };
      },
    },
  ];
}
