import type { Feature, FeatureStep, ReviewComment, ReviewReport } from './types';
import { stepResolved } from './optionalSteps';

export interface ReviewAcceptance {
  revision: number;
  review?: ReviewReport;
  comments: ReviewComment[];
}
export interface ReviewApprovalRequest extends ReviewAcceptance {
  attemptId: string;
  key: string;
}

// Explicit projections keep the confirmation stable after storage/schema normalization.
function reviewSnapshot(review?: ReviewReport): ReviewReport | undefined {
  return (
    review && {
      verdict: review.verdict,
      summary: review.summary,
      findings: review.findings.map(({ id, severity, message, file, line }) => ({
        id,
        severity,
        message,
        file,
        line,
      })),
    }
  );
}
function commentSnapshot(comment: ReviewComment): ReviewComment {
  const { id, stepId, attemptId, text, blocking, resolved, createdAt, file, line } = comment;
  return {
    id,
    stepId,
    attemptId,
    text,
    blocking,
    resolved,
    createdAt,
    file,
    line,
    revision: comment.revision ?? 0,
  };
}

/** Acceptance is attached to the current human-approved revision, never to a future run. */
export function acceptedReviewRemarks(step: FeatureStep): ReviewAcceptance | undefined {
  const attempt = step.attempts.at(-1),
    receipt = attempt?.reviewAcceptance;
  return step.status === 'approved' &&
    attempt?.status === 'approved' &&
    attempt.approvedBy === 'human' &&
    receipt &&
    receipt.revision === (attempt.revision ?? 0) &&
    JSON.stringify(reviewSnapshot(receipt.review)) ===
      JSON.stringify(reviewSnapshot(attempt.review))
    ? receipt
    : undefined;
}

function acceptedCommentKeys(feature: Feature): Set<string> {
  return new Set(
    feature.steps.flatMap((step) =>
      (acceptedReviewRemarks(step)?.comments ?? []).map((comment) =>
        JSON.stringify(commentSnapshot(comment)),
      ),
    ),
  );
}
export function unacceptedBlockingComments(feature: Feature): ReviewComment[] {
  const accepted = acceptedCommentKeys(feature);
  return (feature.reviewComments ?? []).filter(
    (comment) =>
      comment.blocking &&
      !comment.resolved &&
      !accepted.has(JSON.stringify(commentSnapshot(comment))),
  );
}

/** The final step also presents outstanding comments from the rest of the feature. */
export function reviewApprovalRequest(
  feature: Feature,
  step: FeatureStep,
): ReviewApprovalRequest | undefined {
  const attempt = step.attempts.at(-1);
  if (!attempt) return;
  const final = feature.steps.every((other) => other.id === step.id || stepResolved(other));
  const accepted = acceptedCommentKeys(feature);
  const comments = (feature.reviewComments ?? [])
    .filter(
      (comment) =>
        !comment.resolved &&
        (comment.stepId === step.id || final) &&
        !accepted.has(JSON.stringify(commentSnapshot(comment))),
    )
    .map(commentSnapshot);
  const review = reviewSnapshot(attempt.review);
  if (review?.verdict !== 'changes_requested' && !review?.findings.length && !comments.length)
    return;
  const snapshot = { attemptId: attempt.id, revision: attempt.revision ?? 0, review, comments };
  return { ...snapshot, key: JSON.stringify(snapshot) };
}
