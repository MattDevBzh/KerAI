import type { Feature } from '../shared/types';
import type { SessionBatchAction, SessionBatchResult } from '../shared/sessionList';
import type { StudioService } from './StudioService';
import { redact } from './process';

export interface SessionBatchTarget {
  service: Pick<
    StudioService,
    'assertConfigurable' | 'archiveFeature' | 'deleteFeature' | 'recordHumanAction'
  > & { engine: Pick<StudioService['engine'], 'getFeature'> };
  removeDeletedFeature: (id: string) => Promise<void>;
}

/** Resolve each owning store independently; confirmation covers precisely these stable IDs. */
export async function applySessionBatch(
  request: { requestId: string; action: SessionBatchAction; featureIds: string[] },
  resolve: (id: string) => SessionBatchTarget,
  confirmDeletion: (features: Pick<Feature, 'id' | 'title' | 'projects'>[]) => Promise<boolean>,
  progress: (completed: number, total: number) => void,
): Promise<SessionBatchResult> {
  const result: SessionBatchResult = {
    requestId: request.requestId,
    action: request.action,
    succeeded: [],
    failed: [],
    freedBytes: 0,
  };
  const eligible: Pick<Feature, 'id' | 'title' | 'projects'>[] = [];
  for (const id of new Set(request.featureIds)) {
    let title = id;
    try {
      const target = resolve(id);
      const feature = target.service.engine.getFeature(id);
      title = feature.title;
      target.service.assertConfigurable(id);
      if (
        feature.steps.some((step) => step.status === 'running') ||
        feature.autopilot?.status === 'running'
      )
        throw new Error('Arrête la tentative et mets le pilote en pause avant cette action.');
      eligible.push({ id: feature.id, title: feature.title, projects: feature.projects });
    } catch (error) {
      result.failed.push({ featureId: id, title, error: redact((error as Error).message) });
    }
  }
  if (request.action === 'delete' && eligible.length && !(await confirmDeletion(eligible)))
    return { ...result, cancelled: true };
  for (const [index, feature] of eligible.entries()) {
    try {
      // Recheck after the native confirmation: a session may have started or disappeared.
      const target = resolve(feature.id);
      target.service.assertConfigurable(feature.id);
      const current = target.service.engine.getFeature(feature.id);
      if (
        current.steps.some((step) => step.status === 'running') ||
        current.autopilot?.status === 'running'
      )
        throw new Error('La session a démarré depuis la sélection. Arrête-la avant de réessayer.');
      if (request.action === 'delete') {
        result.freedBytes += await target.service.deleteFeature(feature.id);
        await target.removeDeletedFeature(feature.id);
      } else {
        const archived = request.action === 'archive';
        await target.service.recordHumanAction({
          type: 'archiveFeature',
          featureId: feature.id,
          archived,
        });
        await target.service.archiveFeature(feature.id, archived);
      }
      result.succeeded.push(feature.id);
    } catch (error) {
      result.failed.push({
        featureId: feature.id,
        title: feature.title,
        error: redact((error as Error).message),
      });
    }
    progress(index + 1, eligible.length);
  }
  return result;
}
