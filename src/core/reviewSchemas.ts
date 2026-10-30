import { z } from 'zod';
import { parsePullRequestUrl } from '../shared/reviews';
const branch = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      /^refs\/(heads|remotes)\/.+/.test(value) &&
      !/[\s\x00-\x1f~^:?*\[\\]/.test(value) &&
      !value.includes('..'),
    'Branche Git invalide.',
  );
export const reviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('working-tree') }).strict(),
  z
    .object({ kind: z.literal('branches'), source: branch, destination: branch })
    .strict()
    .refine((value) => value.source !== value.destination, 'Choisissez deux branches différentes.'),
  z
    .object({
      kind: z.literal('pull-request'),
      url: z
        .string()
        .trim()
        .max(2048)
        .refine((value) => {
          try {
            parsePullRequestUrl(value);
            return true;
          } catch {
            return false;
          }
        }, 'URL de Pull Request GitHub ou Azure DevOps invalide.'),
    })
    .strict(),
]);
export const reviewDefaultsSchema = z
  .object({
    pullRequest: z.string().min(1).max(200).optional(),
    branch: z.string().min(1).max(200).optional(),
  })
  .strict();
