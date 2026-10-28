import type { ClientMessage, HostMessage } from '../shared/types';
import type { StudioService } from './StudioService';
import { redact } from './process';

/** Routes human review intentions after host validation and archival. */
export async function handleSessionReview(
  message: ClientMessage,
  current: StudioService,
  send: (message: HostMessage) => void,
  notice: (text: string) => void,
): Promise<boolean> {
  switch (message.type) {
    case 'approveStep':
      try {
        if (!message.expectedAttemptId || message.expectedRevision === undefined)
          throw new Error('Recharge le livrable avant de le valider.');
        await current.approveStep(
          message.featureId,
          message.stepId,
          message.expectedAttemptId,
          message.expectedRevision,
          'human',
          message.expectedReviewWarningsKey,
        );
        send({
          type: 'stepApprovalResult',
          featureId: message.featureId,
          stepId: message.stepId,
          attemptId: message.expectedAttemptId,
        });
        notice(
          current.engine.getFeature(message.featureId).status === 'awaiting_final_validation'
            ? 'Parcours relu : la validation définitive reste à confirmer.'
            : 'Étape validée.',
        );
      } catch (error) {
        send({
          type: 'stepApprovalResult',
          featureId: message.featureId,
          stepId: message.stepId,
          attemptId: message.expectedAttemptId,
          error: redact((error as Error).message),
        });
        throw error;
      }
      return true;
    case 'answerQuestions':
      await current.answerQuestions(message.featureId, message.stepId, message.answers);
      return true;
    case 'saveArtifact': {
      try {
        if (
          !message.expectedAttemptId ||
          message.expectedRevision === undefined ||
          !message.expectedStateKey
        )
          throw new Error('Recharge le compte rendu avant de l’enregistrer.');
        await current.saveArtifact(message.featureId, message.stepId, message.content, {
          expectedAttemptId: message.expectedAttemptId,
          expectedRevision: message.expectedRevision,
          expectedStateKey: message.expectedStateKey,
          description: message.description,
          reason: message.reason,
        });
        const attempt = current.engine.getStep(message.featureId, message.stepId).attempts.at(-1)!;
        send({
          type: 'artifactSaveResult',
          featureId: message.featureId,
          stepId: message.stepId,
          attemptId: attempt.id,
          revision: attempt.revision ?? 0,
        });
        notice('Révision du compte rendu enregistrée.');
      } catch (error) {
        send({
          type: 'artifactSaveResult',
          featureId: message.featureId,
          stepId: message.stepId,
          error: redact((error as Error).message),
        });
        throw error;
      }
      return true;
    }
    case 'requestCorrection': {
      try {
        const correctionId = await current.requestCorrection(message.featureId, message);
        send({
          type: 'correctionResult',
          featureId: message.featureId,
          correctionId,
        });
        notice('Correction enregistrée. Le pilote reprend avec les validations habituelles.');
      } catch (error) {
        send({
          type: 'correctionResult',
          featureId: message.featureId,
          error: redact((error as Error).message),
        });
        throw error;
      }
      return true;
    }
    case 'finalizeFeature': {
      try {
        const finalizationId = await current.finalizeFeature(
          message.featureId,
          message.expectedStateKey,
        );
        send({
          type: 'featureFinalizationResult',
          featureId: message.featureId,
          finalizationId,
        });
        notice('Validation définitive enregistrée : session terminée.');
      } catch (error) {
        send({
          type: 'featureFinalizationResult',
          featureId: message.featureId,
          error: redact((error as Error).message),
        });
        throw error;
      }
      return true;
    }
    case 'configureStep': {
      current.assertConfigurable(message.featureId);
      if (
        !current.state.agents.some((agent) => agent.id === message.agentId) ||
        message.skills.some((id) => !current.state.skills.some((skill) => skill.id === id))
      )
        throw new Error('Agent ou skill inconnu.');
      current.engine.configureStep(message.featureId, message.stepId, {
        agentId: message.agentId,
        model: message.model,
        reasoning: message.reasoning,
        skills: message.skills,
        maxAttempts: message.maxAttempts,
        initialContext: message.initialContext,
        mcpServerIds: message.mcpServerIds,
        askBeforeRun: message.askBeforeRun,
      });
      await current.persist();
      return true;
    }
    default:
      return false;
  }
}
