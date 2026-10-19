import type { Feature, Usage, SessionObservation } from './types';
import { usageCredits } from './credits';

export function sumUsage(values: (Usage | undefined)[]): Usage | undefined {
  if (!values.length) return undefined;
  const result: Usage = { source: 'measured' };
  for (const value of values) {
    const known = (n: unknown): n is number =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!value || value.source !== 'measured') {
      result.incompleteTokens = true;
      result.incompleteCost = true;
      continue;
    }
    if (known(value.inputTokens))
      result.inputTokens = (result.inputTokens ?? 0) + value.inputTokens;
    if (known(value.outputTokens))
      result.outputTokens = (result.outputTokens ?? 0) + value.outputTokens;
    if (value.incompleteTokens || !known(value.inputTokens) || !known(value.outputTokens))
      result.incompleteTokens = true;
    if (value.unit === 'nano-AIU' && known(value.cost)) {
      result.cost = (result.cost ?? 0) + value.cost;
      result.unit = 'nano-AIU';
    }
    if (value.incompleteCost || value.unit !== 'nano-AIU' || !known(value.cost))
      result.incompleteCost = true;
    const metrics = value.byModel ?? {
      [value.model || 'Non communiqué']: {
        inputTokens: value.inputTokens,
        outputTokens: value.outputTokens,
        cost: value.unit === 'nano-AIU' ? value.cost : undefined,
        incompleteTokens: value.incompleteTokens,
        incompleteCost: value.incompleteCost || value.unit !== 'nano-AIU',
      },
    };
    const breakdown = (result.byModel ??= Object.create(null));
    for (const [model, metric] of Object.entries(metrics)) {
      const target = (breakdown[model] ??= {});
      if (known(metric.inputTokens))
        target.inputTokens = (target.inputTokens ?? 0) + metric.inputTokens;
      if (known(metric.outputTokens))
        target.outputTokens = (target.outputTokens ?? 0) + metric.outputTokens;
      if (value.unit === 'nano-AIU' && known(metric.cost))
        target.cost = (target.cost ?? 0) + metric.cost;
      if (metric.incompleteTokens || !known(metric.inputTokens) || !known(metric.outputTokens))
        target.incompleteTokens = true;
      if (value.unit !== 'nano-AIU' || metric.incompleteCost || !known(metric.cost))
        target.incompleteCost = true;
    }
  }
  return result;
}
export const featureUsage = (feature: Feature) =>
  sumUsage(feature.steps.flatMap((step) => step.attempts.map((attempt) => attempt.usage)));
export const observerUsage = (review: SessionObservation) =>
  sumUsage(review.calls.map((call) => call.usage));
export const observationModels = (review: SessionObservation): string[] => [
  ...new Set(
    review.calls.flatMap((call) =>
      call.usage?.byModel && Object.keys(call.usage.byModel).length
        ? Object.keys(call.usage.byModel)
        : [call.model || 'Non communiqué'],
    ),
  ),
];
const modelUsageLines = (usage: Usage | undefined): string[] =>
  Object.entries(usage?.byModel ?? {}).map(
    ([model, metric]) =>
      `${model} · ${usageCredits({ source: 'measured', unit: 'nano-AIU', ...metric })} · tokens entrée ${metric.inputTokens ?? '?'} / sortie ${metric.outputTokens ?? '?'}`,
  );
export function observationMarkdown(review: SessionObservation, feature?: Feature): string {
  const parts = [
    `# Analyse de ${review.featureTitle}`,
    `${review.createdAt} · ${review.status}`,
    `Couverture : ${review.coverage.analyzedParts}/${review.coverage.totalParts} parties · ${review.coverage.complete ? 'complète' : 'partielle'}`,
    ...review.coverage.warnings.map((w) => `> ${w}`),
  ];
  const work = sumUsage(review.phases.map((p) => p.usage)),
    reviewUsage = observerUsage(review);
  parts.push(
    `Travail de la feature analysée : ${work ? usageCredits(work) : 'Crédits non communiqués'}. Cette revue : ${reviewUsage ? usageCredits(reviewUsage) : 'Crédits non communiqués'}.`,
  );
  if (feature) {
    const allReviews = sumUsage(
      (feature.observations ?? []).flatMap((r) => r.calls.map((c) => c.usage)),
    );
    const total = sumUsage([featureUsage(feature), allReviews]);
    parts.push(
      `Revues cumulées : ${allReviews ? usageCredits(allReviews) : 'Crédits non communiqués'}. Total actuel de la session : ${total ? usageCredits(total) : 'Crédits non communiqués'}.`,
    );
  }
  for (const phase of review.phases) {
    parts.push(
      `## ${phase.name}${phase.status === 'skipped' ? ' — Passée par l’humain, non exécutée' : ''}`,
      `Agent : ${phase.agent} · Modèles : ${phase.models.join(', ') || 'Non communiqués'} · ${phase.attempts} tentative(s) · ${Math.round(phase.durationMs / 1000)} s · ${phase.usage ? usageCredits(phase.usage) : 'Crédits non communiqués'}`,
      ...modelUsageLines(phase.usage).map((line) => `- ${line}`),
    );
    for (const analysis of phase.analyses) {
      parts.push(analysis.summary, ...analysis.strengths.map((s) => `- Point réussi : ${s}`));
      for (const finding of analysis.findings)
        parts.push(
          `### ${finding.title} (${finding.kind}, impact ${finding.impact})`,
          finding.detail,
          `Sources : ${finding.references.join(', ')}`,
        );
    }
  }
  if (review.global) {
    parts.push(
      '## Commentaires globaux',
      review.global.summary,
      ...review.global.strengths.map((s) => `- ${s}`),
    );
    for (const finding of review.global.findings)
      parts.push(
        `### ${finding.title}`,
        finding.detail,
        `Sources : ${finding.references.join(', ')}`,
      );
  }
  const usage = observerUsage(review);
  parts.push(
    '## Bilan de l’Observateur',
    `Modèle demandé : ${review.requestedModel}`,
    `Modèles effectifs : ${observationModels(review).join(', ') || 'Aucun appel'}`,
    `${review.calls.length} appel(s) · ${usage ? usageCredits(usage) : 'Crédits non communiqués'} · entrée ${usage?.inputTokens ?? '?'} tokens · sortie ${usage?.outputTokens ?? '?'} tokens`,
    ...modelUsageLines(usage).map((line) => `- ${line}`),
  );
  if (review.error) parts.push(`Analyse incomplète : ${review.error}`);
  return parts.join('\n\n');
}
export function observationHtml(review: SessionObservation, feature?: Feature): string {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
  const analysis = (a: NonNullable<SessionObservation['global']>) =>
    `<p>${escape(a.summary)}</p><ul>${a.strengths.map((s) => `<li>${escape(s)}</li>`).join('')}</ul>${a.findings.map((f) => `<article class="finding ${f.kind}"><span>${escape(f.kind)} · ${escape(f.impact)}</span><h3>${escape(f.title)}</h3><p>${escape(f.detail)}</p><small>Sources : ${f.references.map(escape).join(', ')}</small></article>`).join('')}`;
  const usage = observerUsage(review);
  const modelBreakdown = (value: Usage | undefined) => {
    const lines = modelUsageLines(value);
    return lines.length
      ? `<h3>Consommation par modèle</h3><ul>${lines.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>`
      : '';
  };
  const work = sumUsage(review.phases.map((p) => p.usage));
  const totals = feature
    ? `<p>Revues cumulées : ${escape(usageCredits(sumUsage((feature.observations ?? []).flatMap((r) => r.calls.map((c) => c.usage))) ?? { source: 'measured' }))}. Total actuel de la session : ${escape(usageCredits(sumUsage([featureUsage(feature), sumUsage((feature.observations ?? []).flatMap((r) => r.calls.map((c) => c.usage)))]) ?? { source: 'measured' }))}.</p>`
    : '';
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(review.featureTitle)} — Observateur</title><style>body{font:16px/1.6 system-ui;color:#18302b;background:#f3f6f3;margin:0}main{max-width:1000px;margin:auto;padding:40px 24px}header{background:#183b33;color:white;padding:32px;border-radius:20px}section{background:white;border:1px solid #dce4dd;border-radius:18px;padding:28px;margin:24px 0}h1{font-size:32px}h2{font-size:24px}p{white-space:pre-wrap}.facts{color:#45675b}.finding{border-left:4px solid #597c6a;padding:12px 20px;margin:18px 0;background:#f5f8f5}.recommendation{border-color:#b78d3d}.finding span,small{font-size:13px;color:#617266}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #dce4dd}nav a{color:#285e4b;display:inline-block;margin:8px}aside{padding:16px;background:#fff3d9;border-radius:12px}@media(max-width:600px){main{padding:16px}section{padding:18px}table{font-size:12px}}@media print{body{background:white}main{padding:0}section{break-inside:avoid}nav{display:none}}</style><main><header><small style="color:#cce6d4">FEATURE STUDIO · OBSERVATEUR</small><h1>${escape(review.featureTitle)}</h1><p>${escape(review.createdAt)} · ${escape(review.status)} · couverture ${review.coverage.analyzedParts}/${review.coverage.totalParts}</p></header>${review.coverage.warnings.map((w) => `<aside>${escape(w)}</aside>`).join('')}<nav>${review.phases.map((p, i) => `<a href="#phase-${i}">${escape(p.name)}</a>`).join('')}<a href="#global">Commentaires globaux</a><a href="#observer">Bilan de l’Observateur</a></nav><section><h2>Parcours et consommation</h2><p>Travail analysé : ${escape(usageCredits(work ?? { source: 'measured' }))}. Cette revue : ${escape(usageCredits(usage ?? { source: 'measured' }))}.</p>${totals}<table><thead><tr><th>Phase</th><th>Agent / modèles</th><th>Tentatives</th><th>Crédits</th></tr></thead><tbody>${review.phases.map((p) => `<tr><td>${escape(p.name)}</td><td>${escape(p.agent)}<br>${escape(p.models.join(', ') || 'Non communiqués')}</td><td>${p.attempts}</td><td>${escape(p.usage ? usageCredits(p.usage) : 'Non communiqués')}</td></tr>`).join('')}</tbody></table></section>${review.phases.map((p, i) => `<section id="phase-${i}"><h2>${i + 1}. ${escape(p.name)}${p.status === 'skipped' ? ' — Passée par l’humain, non exécutée' : ''}</h2><p class="facts">${escape(p.agent)} · ${escape(p.models.join(', ') || 'Modèles non communiqués')} · ${escape(p.usage ? usageCredits(p.usage) : 'Crédits non communiqués')} · ${Math.round(p.durationMs / 1000)} s</p>${modelBreakdown(p.usage)}${p.analyses.map(analysis).join('')}${p.analyzedParts < p.totalParts ? '<aside>Phase partiellement analysée.</aside>' : ''}</section>`).join('')}<section id="global"><h2>Commentaires globaux et priorités</h2>${review.global ? analysis(review.global) : '<p>Synthèse non disponible.</p>'}</section><section id="observer"><h2>Bilan de l’Observateur</h2><p>Modèle demandé : ${escape(review.requestedModel)}</p><p>Modèles effectifs : ${escape(observationModels(review).join(', ') || 'Aucun appel')} · ${review.calls.length} appels · ${escape(usage ? usageCredits(usage) : 'Crédits non communiqués')}</p><p>Tokens : entrée ${usage?.inputTokens ?? '?'} / sortie ${usage?.outputTokens ?? '?'}. Durée : ${review.finishedAt ? Math.max(0, Math.round((Date.parse(review.finishedAt) - Date.parse(review.createdAt)) / 1000)) : '?'} s.</p>${modelBreakdown(usage)}${review.error ? `<aside>${escape(review.error)}</aside>` : ''}</section></main></html>`;
}
