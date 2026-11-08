import { z } from 'zod';
import type { PrAdminSnapshot, PrDiffBlock, PrThreadStatus } from '../shared/prAdministration';
const sha = z.string().regex(/^[a-f0-9]{40}$/i);
const record = z.record(z.string(), z.unknown());
export const prThreadSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  isDeleted: z.boolean().optional(),
  comments: z
    .array(
      z.object({
        id: z.number().int().positive(),
        content: z.string().optional(),
        author: z.object({ id: z.string() }).optional(),
        isDeleted: z.boolean().optional(),
        parentCommentId: z.number().optional(),
      }),
    )
    .max(500),
  threadContext: z
    .object({
      filePath: z.string(),
      leftFileStart: z.object({ line: z.number() }).nullish(),
      rightFileStart: z.object({ line: z.number() }).nullish(),
    })
    .nullish(),
});
export type PrAdminThread = z.infer<typeof prThreadSchema>;
export class PrAdministrationApi {
  constructor(
    private request: (
      suffix: string,
      body?: unknown,
      method?: 'PATCH',
    ) => Promise<Record<string, unknown>>,
    private webUrl: (id: number) => string,
    private identity: () => Promise<string>,
  ) {}
  private route(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('PR invalide.');
    return `/pullrequests/${id}`;
  }
  async actorId() {
    return this.identity();
  }
  async snapshot(id: number): Promise<PrAdminSnapshot> {
    const route = this.route(id);
    const pr = await this.request(`${route}?api-version=7.1`);
    if (pr.forkSource)
      throw new Error(
        'Cette intervention nécessite une PR dont la branche source appartient au dépôt de la session.',
      );
    const iterations = await this.request(`${route}/iterations?api-version=7.1`);
    const rows = z
      .array(
        z.object({ id: z.number().int().positive(), sourceRefCommit: z.object({ commitId: sha }) }),
      )
      .parse(iterations.value);
    const iteration = rows.sort((a, b) => b.id - a.id)[0];
    const sourceHead = sha.parse(record.parse(pr.lastMergeSourceCommit).commitId),
      targetHead = sha.parse(record.parse(pr.lastMergeTargetCommit).commitId);
    if (!iteration || iteration.sourceRefCommit.commitId !== sourceHead)
      throw new Error('Azure actualise encore la PR. Réessaie après la mise à jour du diff.');
    const sourceBranch = z.string().startsWith('refs/heads/').parse(pr.sourceRefName);
    const targetBranch = z.string().startsWith('refs/heads/').parse(pr.targetRefName);
    for (const [branch, expected] of [
      [sourceBranch, sourceHead],
      [targetBranch, targetHead],
    ]) {
      const refs = await this.request(
        `/refs?filter=${encodeURIComponent(branch.slice(5))}&api-version=7.1`,
      );
      const ref = z
        .array(z.object({ name: z.string(), objectId: sha }))
        .parse(refs.value)
        .find((ref) => ref.name === branch);
      if (ref?.objectId !== expected)
        throw new Error(
          'La branche a changé et Azure actualise encore le diff. Prépare un nouvel aperçu.',
        );
    }
    const comparison = await this.request(
      `/diffs/commits?baseVersion=${targetHead}&baseVersionType=commit&targetVersion=${sourceHead}&targetVersionType=commit&diffCommonCommit=true&$top=1&api-version=7.1`,
    );
    const baseHead = sha.parse(comparison.commonCommit);
    return {
      id,
      url: this.webUrl(id),
      title: z.string().parse(pr.title),
      description: String(pr.description ?? ''),
      sourceBranch,
      targetBranch,
      sourceHead,
      targetHead,
      baseHead,
      iteration: iteration.id,
      status: z.string().parse(pr.status),
    };
  }
  async changes(snapshot: PrAdminSnapshot) {
    const result = await this.request(
      `${this.route(snapshot.id)}/iterations/${snapshot.iteration}/changes?$compareTo=0&$top=2000&api-version=7.1`,
    );
    const changes = z
      .array(
        z.object({
          changeTrackingId: z.number().int().positive(),
          item: z.object({ path: z.string() }),
          originalPath: z.string().optional(),
        }),
      )
      .max(2000)
      .parse(result.changeEntries);
    return { changes, partial: typeof result.nextSkip === 'number' && result.nextSkip > 0 };
  }
  async threads(snapshot: PrAdminSnapshot) {
    const result = await this.request(
      `${this.route(snapshot.id)}/threads?$iteration=${snapshot.iteration}&$baseIteration=${snapshot.iteration}&api-version=7.1`,
    );
    return z.array(prThreadSchema).max(2000).parse(result.value);
  }
  async thread(snapshot: PrAdminSnapshot, id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Fil invalide.');
    return prThreadSchema.parse(
      await this.request(
        `${this.route(snapshot.id)}/threads/${id}?$iteration=${snapshot.iteration}&$baseIteration=${snapshot.iteration}&api-version=7.1`,
      ),
    );
  }
  async updateField(snapshot: PrAdminSnapshot, field: 'title' | 'description', content: string) {
    await this.request(`${this.route(snapshot.id)}?api-version=7.1`, { [field]: content }, 'PATCH');
  }
  async createThread(
    snapshot: PrAdminSnapshot,
    block: PrDiffBlock,
    content: string,
    status: PrThreadStatus,
  ) {
    return prThreadSchema.parse(
      await this.request(`${this.route(snapshot.id)}/threads?api-version=7.1`, {
        comments: [{ parentCommentId: 0, content, commentType: 1 }],
        status,
        threadContext: {
          filePath: '/' + block.path,
          [`${block.side}FileStart`]: { line: block.startLine, offset: 0 },
          [`${block.side}FileEnd`]: { line: block.endLine, offset: 1 },
        },
        pullRequestThreadContext: {
          changeTrackingId: block.changeTrackingId,
          iterationContext: {
            firstComparingIteration: snapshot.iteration,
            secondComparingIteration: snapshot.iteration,
          },
        },
      }),
    );
  }
  async updateComment(
    snapshot: PrAdminSnapshot,
    threadId: number,
    commentId: number,
    content: string,
  ) {
    if (![threadId, commentId].every((id) => Number.isSafeInteger(id) && id > 0))
      throw new Error('Commentaire invalide.');
    await this.request(
      `${this.route(snapshot.id)}/threads/${threadId}/comments/${commentId}?api-version=7.1`,
      { content },
      'PATCH',
    );
  }
}
