import type { Feature, Usage } from './types';
import { allFeatures } from './subplans';

export type EvaluationPhase =
  | 'learning'
  | 'maintenance'
  | 'analysis'
  | 'development'
  | 'verification'
  | 'unclassified';
export const evaluationPhaseLabels: Record<EvaluationPhase, string> = {
  learning: 'Apprentissage',
  maintenance: 'Entretien',
  analysis: 'Analyse',
  development: 'Développement',
  verification: 'Recette',
  unclassified: 'Non ventilé',
};
export const evaluationTimeLabels = {
  preparation: 'Préparation',
  connection: 'Connexion',
  demonstration: 'Démonstration',
  work: 'Travail actif',
  waiting: 'Attente humaine',
} as const;
export type EvaluationMetric = 'tokens' | 'cost' | 'activeSeconds' | 'totalSeconds';
export type EvaluationAttemptRef = { featureId: string; stepId: string; attemptId: string };
export interface NavigationCampaignDefinition {
  id: string;
  name: string;
  profile: string;
  tickets: { id: string; label: string }[];
  repetitions: number;
  phases: ('analysis' | 'development' | 'verification')[];
}
export interface NavigationEvaluationInput {
  id: string;
  condition: 'A' | 'B';
  ticketId?: string;
  repetition: number;
  order: number;
  phase: EvaluationPhase;
  outcome: 'succeeded' | 'failed' | 'blocked' | 'cancelled';
  qualityAccepted: boolean;
  attemptRefs: EvaluationAttemptRef[];
  providerMode: 'linked-attempts' | 'none-declared' | 'unknown';
  times: Partial<Record<keyof typeof evaluationTimeLabels, number>>;
  configuration: {
    model: string;
    runtime: string;
    permissions: string;
    build: string;
    dataSnapshot: string;
    criteria: string;
    role: string;
    catalogueSnapshot: string;
    indexSnapshot: string;
  };
  observations?: string;
}
export interface EvaluationReceipt {
  ref: EvaluationAttemptRef;
  status: string;
  model?: string;
  usage?: Usage;
}
export interface NavigationEvaluationEntry extends NavigationEvaluationInput {
  receipts: EvaluationReceipt[];
  savedAt: string;
}
export interface NavigationCampaign extends NavigationCampaignDefinition {
  entries: NavigationEvaluationEntry[];
  createdAt: string;
  updatedAt: string;
}
export interface EvaluationValue {
  value: number | null;
  unit?: string;
  reasons: string[];
}
export interface EvaluationComparison {
  ticketId: string;
  repetition: number;
  order: number;
  metrics: Record<
    EvaluationMetric,
    {
      a: EvaluationValue;
      b: EvaluationValue;
      eligible: boolean;
      reasons: string[];
      gain: number | null;
    }
  >;
}
export interface NavigationEvaluationReport {
  plannedPairs: number;
  comparisons: EvaluationComparison[];
  metrics: Record<
    EvaluationMetric,
    {
      admissiblePairs: number;
      medianPairedGain: number | null;
      totalA: EvaluationValue;
      totalB: EvaluationValue;
      cumulativeGain: number | null;
      cumulativeReasons: string[];
      breakEven: {
        repetition: number;
        firstUse: number | null;
        finalGain: number | null;
        reversed: boolean;
      }[];
    }
  >;
  entries: number;
  failures: number;
  unknownTimes: number;
}
export interface NavigationEvaluationSnapshot {
  campaigns: NavigationCampaign[];
  reports: Record<string, NavigationEvaluationReport>;
}
export type NavigationEvaluationCommand =
  | { action: 'evaluationLoad' }
  | { action: 'evaluationSaveCampaign'; campaign: NavigationCampaignDefinition }
  | { action: 'evaluationSaveEntry'; campaignId: string; entry: NavigationEvaluationInput }
  | { action: 'evaluationDeleteEntry'; campaignId: string; entryId: string }
  | { action: 'evaluationExport'; campaignId: string };
export const evaluationRefKey = (ref: EvaluationAttemptRef) =>
  `${ref.featureId}/${ref.stepId}/${ref.attemptId}`;
export function evaluationAttempts(features: Feature[]) {
  return allFeatures(features).flatMap((feature) =>
    feature.steps.flatMap((step) =>
      step.attempts.map((attempt) => ({
        ref: { featureId: feature.id, stepId: step.id, attemptId: attempt.id },
        label: `${feature.title} · ${step.name} · ${attempt.id.slice(0, 8)}`,
        status: attempt.status,
        model: attempt.usage?.model ?? attempt.model,
        usage: attempt.usage,
      })),
    ),
  );
}
const metrics: EvaluationMetric[] = ['tokens', 'cost', 'activeSeconds', 'totalSeconds'];
function measure(entries: NavigationEvaluationEntry[], metric: EvaluationMetric): EvaluationValue {
  if (!entries.length) return { value: null, reasons: ['Aucune entrée.'] };
  const reasons: string[] = [];
  let value = 0;
  const units = new Set<string>();
  for (const entry of entries) {
    if (metric === 'activeSeconds' || metric === 'totalSeconds') {
      const keys = Object.keys(evaluationTimeLabels) as (keyof typeof evaluationTimeLabels)[];
      for (const key of keys.filter((key) => metric === 'totalSeconds' || key !== 'waiting')) {
        if (entry.times[key] === undefined) reasons.push(`${evaluationTimeLabels[key]} inconnu.`);
        else value += entry.times[key]!;
      }
      continue;
    }
    if (entry.providerMode === 'none-declared') continue;
    if (
      entry.providerMode === 'unknown' ||
      !entry.receipts.length ||
      entry.receipts.length !== entry.attemptRefs.length
    ) {
      reasons.push('Usage fournisseur incomplet.');
      continue;
    }
    for (const receipt of entry.receipts) {
      const usage = receipt.usage;
      if (metric === 'tokens') {
        if (
          !usage ||
          usage.inputTokens === undefined ||
          usage.outputTokens === undefined ||
          usage.incompleteTokens
        )
          reasons.push('Tokens incomplets.');
        else value += usage.inputTokens + usage.outputTokens;
      } else {
        if (!usage || usage.cost === undefined || !usage.unit || usage.incompleteCost)
          reasons.push('Consommation fournisseur incomplète.');
        else {
          value += usage.cost;
          units.add(usage.unit);
        }
      }
    }
  }
  if (units.size > 1) reasons.push('Unités fournisseur incompatibles.');
  return {
    value: reasons.length ? null : value,
    unit: metric === 'cost' ? [...units][0] : metric === 'tokens' ? 'tokens' : 's',
    reasons: [...new Set(reasons)],
  };
}
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const ratio = (a: EvaluationValue, b: EvaluationValue) =>
  a.value !== null && a.value > 0 && b.value !== null && (!a.unit || !b.unit || a.unit === b.unit)
    ? 1 - b.value / a.value
    : null;
function overheadCoverage(rows: NavigationEvaluationEntry[], repetitions: number[]) {
  const reasons: string[] = [];
  for (const repetition of repetitions)
    for (const condition of ['A', 'B'] as const)
      for (const phase of ['learning', 'maintenance'] as const) {
        if (
          !rows.some(
            (row) =>
              row.repetition === repetition && row.condition === condition && row.phase === phase,
          )
        )
          reasons.push(
            `Répétition ${repetition} ${condition} : ${evaluationPhaseLabels[phase].toLocaleLowerCase()} non renseigné (zéro explicite requis si absent).`,
          );
      }
  return reasons;
}
export function navigationEvaluationReport(
  campaign: NavigationCampaign,
): NavigationEvaluationReport {
  const comparisons: EvaluationComparison[] = [];
  for (let repetition = 1; repetition <= campaign.repetitions; repetition++)
    for (const ticket of campaign.tickets) {
      const entries = campaign.entries.filter(
        (entry) =>
          entry.ticketId === ticket.id &&
          entry.repetition === repetition &&
          campaign.phases.includes(entry.phase as 'analysis'),
      );
      const a = entries.filter((entry) => entry.condition === 'A');
      const b = entries.filter((entry) => entry.condition === 'B');
      const reasons: string[] = [];
      for (const phase of campaign.phases) {
        const left = a.filter((entry) => entry.phase === phase),
          right = b.filter((entry) => entry.phase === phase);
        if (left.length !== 1 || right.length !== 1) {
          reasons.push(`${evaluationPhaseLabels[phase]} : exactement une entrée A et B requise.`);
          continue;
        }
        for (const key of [
          'model',
          'runtime',
          'permissions',
          'build',
          'dataSnapshot',
          'criteria',
          'role',
        ] as const) {
          if (!left[0].configuration[key].trim() || !right[0].configuration[key].trim())
            reasons.push(`${key} inconnu.`);
          else if (left[0].configuration[key] !== right[0].configuration[key])
            reasons.push(`${key} différent entre A et B.`);
        }
        for (const row of [...left, ...right]) {
          if (
            !row.configuration.catalogueSnapshot.trim() ||
            !row.configuration.indexSnapshot.trim()
          )
            reasons.push('Instantané de bibliothèque ou index initial inconnu.');
          const actualModels = [
            ...new Set(
              row.receipts
                .flatMap((receipt) => [
                  receipt.usage?.model ?? receipt.model,
                  ...Object.keys(receipt.usage?.byModel ?? {}),
                ])
                .filter(Boolean),
            ),
          ];
          if (actualModels.some((model) => model !== row.configuration.model))
            reasons.push('Modèle reçu différent du modèle déclaré.');
          for (const key of ['catalogueSnapshot', 'indexSnapshot'] as const) {
            const initial = campaign.entries.find(
              (other) =>
                other.condition === row.condition &&
                other.repetition === 1 &&
                campaign.phases.includes(other.phase as 'analysis'),
            );
            if (initial && initial.configuration[key] !== row.configuration[key])
              reasons.push(`${key} initial différent entre utilisations ou répétitions.`);
          }
        }
      }
      if (entries.some((entry) => entry.outcome !== 'succeeded' || !entry.qualityAccepted))
        reasons.push('Qualité non acceptée ou tâche non réussie.');
      const record = {} as EvaluationComparison['metrics'];
      for (const metric of metrics) {
        const av = measure(a, metric),
          bv = measure(b, metric);
        const exclusions = [...reasons, ...av.reasons, ...bv.reasons];
        if (av.value === 0) exclusions.push('Dénominateur A nul.');
        if (av.unit && bv.unit && av.unit !== bv.unit) exclusions.push('Unités A/B incompatibles.');
        const eligible = !exclusions.length;
        record[metric] = {
          a: av,
          b: bv,
          eligible,
          reasons: [...new Set(exclusions)],
          gain: eligible ? ratio(av, bv) : null,
        };
      }
      comparisons.push({
        ticketId: ticket.id,
        repetition,
        order: Math.max(0, ...entries.map((entry) => entry.order)),
        metrics: record,
      });
    }
  const outsideScope = (entry: NavigationEvaluationEntry) =>
    ['analysis', 'development', 'verification'].includes(entry.phase) &&
    !campaign.phases.includes(entry.phase as 'analysis');
  const summary = {} as NavigationEvaluationReport['metrics'];
  for (const metric of metrics) {
    const accepted = comparisons.filter((pair) => pair.metrics[metric].eligible);
    const totalA = measure(
        campaign.entries.filter((entry) => entry.condition === 'A'),
        metric,
      ),
      totalB = measure(
        campaign.entries.filter((entry) => entry.condition === 'B'),
        metric,
      );
    const cumulativeReasons = [
      ...overheadCoverage(
        campaign.entries,
        Array.from({ length: campaign.repetitions }, (_, index) => index + 1),
      ),
      ...totalA.reasons,
      ...totalB.reasons,
    ];
    if (accepted.length !== comparisons.length || !comparisons.length)
      cumulativeReasons.push('Toutes les paires prévues ne sont pas admissibles.');
    if (campaign.entries.some((entry) => entry.phase === 'unclassified'))
      cumulativeReasons.push('Des usages restent non ventilés.');
    if (campaign.entries.some(outsideScope))
      cumulativeReasons.push('Des phases mesurées sont hors du périmètre prévu.');
    if (totalA.value === 0) cumulativeReasons.push('Dénominateur A nul.');
    if (totalA.unit && totalB.unit && totalA.unit !== totalB.unit)
      cumulativeReasons.push('Unités A/B incompatibles.');
    const complete =
      !cumulativeReasons.length &&
      accepted.length === comparisons.length &&
      comparisons.length > 0 &&
      !campaign.entries.some((entry) => entry.phase === 'unclassified');
    const breakEven: NavigationEvaluationReport['metrics'][EvaluationMetric]['breakEven'] = [];
    for (let repetition = 1; repetition <= campaign.repetitions; repetition++) {
      const pairs = comparisons
        .filter((pair) => pair.repetition === repetition)
        .sort((a, b) => a.order - b.order);
      const rows = campaign.entries.filter((entry) => entry.repetition === repetition);
      let firstUse: number | null = null;
      const eligible =
        pairs.length > 0 &&
        pairs.every((pair) => pair.metrics[metric].eligible) &&
        !rows.some((row) => row.phase === 'unclassified' || outsideScope(row)) &&
        !overheadCoverage(rows, [repetition]).length;
      if (eligible)
        pairs.forEach((pair, index) => {
          // A use is a completed pair: never count A of a future pair without its B.
          const completedTickets = new Set(pairs.slice(0, index + 1).map((item) => item.ticketId));
          const prefix = rows.filter((row) =>
            row.phase === 'learning' || row.phase === 'maintenance'
              ? row.order <= pair.order
              : !!row.ticketId && completedTickets.has(row.ticketId),
          );
          const gain = ratio(
            measure(
              prefix.filter((row) => row.condition === 'A'),
              metric,
            ),
            measure(
              prefix.filter((row) => row.condition === 'B'),
              metric,
            ),
          );
          if (firstUse === null && gain !== null && gain > 0) firstUse = index + 1;
        });
      const finalGain = eligible
        ? ratio(
            measure(
              rows.filter((row) => row.condition === 'A'),
              metric,
            ),
            measure(
              rows.filter((row) => row.condition === 'B'),
              metric,
            ),
          )
        : null;
      breakEven.push({
        repetition,
        firstUse: finalGain === null ? null : firstUse,
        finalGain,
        reversed: firstUse !== null && finalGain !== null && finalGain <= 0,
      });
    }
    summary[metric] = {
      admissiblePairs: accepted.length,
      medianPairedGain: median(accepted.map((pair) => pair.metrics[metric].gain!)),
      totalA,
      totalB,
      cumulativeGain: complete ? ratio(totalA, totalB) : null,
      cumulativeReasons: [...new Set(cumulativeReasons)],
      breakEven,
    };
  }
  return {
    plannedPairs: campaign.tickets.length * campaign.repetitions,
    comparisons,
    metrics: summary,
    entries: campaign.entries.length,
    failures: campaign.entries.reduce(
      (count, row) =>
        count +
        Math.max(
          row.outcome !== 'succeeded' ? 1 : 0,
          row.receipts.filter((receipt) =>
            ['failed', 'cancelled', 'interrupted'].includes(receipt.status),
          ).length,
        ),
      0,
    ),
    unknownTimes: campaign.entries.reduce(
      (n, row) =>
        n +
        Object.keys(evaluationTimeLabels).filter(
          (key) => row.times[key as keyof typeof evaluationTimeLabels] === undefined,
        ).length,
      0,
    ),
  };
}
