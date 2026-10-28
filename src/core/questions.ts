import type { AnsweredQuestion, Attempt, Question } from '../shared/types';

/** Only a single explicit recommendation is actionable; never infer one from the prose. */
export function recommendedChoice(choices?: string[]): string | undefined {
  const recommended = choices?.filter((choice) => {
    if (!choice.trim() || choice.length > 30000) return false;
    const label = choice
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[*_`]/g, '')
      .trim()
      .toLowerCase();
    return (
      /(?:\(\s*(?:recommended|recommandee?)\s*\)|\[\s*(?:recommended|recommandee?)\s*\])/.test(
        label,
      ) ||
      /(?:\s[-–—:]\s*(?:recommended|recommandee?)$|^(?:recommended|recommandee?)\s*:)/.test(label)
    );
  });
  return recommended?.length === 1 ? recommended[0] : undefined;
}

export function sameQuestion(left: Question, right: Question): boolean {
  return (
    left.id === right.id &&
    left.text === right.text &&
    JSON.stringify(left.choices) === JSON.stringify(right.choices)
  );
}

/** Legacy answers are recoverable only when this attempt actually retains the question. */
export function boundAnswers(
  attempt: Attempt | undefined,
  stepId: string,
): Record<string, AnsweredQuestion> {
  const bindings: Record<string, AnsweredQuestion> = Object.create(null);
  if (!attempt) return bindings;
  for (const [id, answer] of Object.entries(attempt.answers)) {
    if (!answer.trim()) continue;
    const question = attempt.questions.find((item) => item.id === id);
    const previous =
      attempt.answerBindings && Object.hasOwn(attempt.answerBindings, id)
        ? attempt.answerBindings[id]
        : undefined;
    if (
      previous &&
      previous.question.id === id &&
      previous.origin.stepId === stepId &&
      (question ? sameQuestion(previous.question, question) : previous.answer === answer)
    )
      bindings[id] = { ...structuredClone(previous), answer };
    else if (!previous && question)
      bindings[id] = {
        question: structuredClone(question),
        answer,
        origin: { stepId, attemptId: attempt.id },
      };
  }
  return bindings;
}
