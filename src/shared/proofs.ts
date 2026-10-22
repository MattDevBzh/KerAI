import type { Feature } from './types';
import type { ImageAttachment } from './images';
export interface ProofClaim {
  id: string;
  supersedes?: string;
  text: string;
  proofIds: string[];
  verdict: 'supported' | 'contradicted' | 'unverified';
  author: 'agent' | 'human';
  at: string;
  reportRevision: number;
}
export interface ProofEntry {
  id: string;
  kind: 'image' | 'test' | 'file' | 'web' | 'context' | 'activity' | 'report' | 'approval';
  title: string;
  at: string;
  origin: 'human' | 'runtime' | 'agent';
  content: string;
  state: 'observed' | 'failed' | 'pending' | 'recheck';
  reason?: string;
  stepId?: string;
  attemptId?: string;
  reportRevision?: number;
  path?: string;
  url?: string;
  image?: ImageAttachment;
  evidenceId?: string;
  attachmentId?: string;
  digest?: string;
}
export interface ProofCheck {
  at: string;
  state: 'unchanged' | 'changed' | 'unavailable';
  reason: string;
}
export interface ProofDossier {
  sources: ProofEntry[];
  claims: (ProofClaim & {
    stepId: string;
    attemptId: string;
    stale: boolean;
    missingIds: string[];
  })[];
}
const argsOf = (value: string): Record<string, unknown> => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};
/** Derived from persisted facts. A model statement can never manufacture a runtime source. */
export function proofDossier(feature: Feature): ProofDossier {
  const sources: ProofEntry[] = [];
  const claims: ProofDossier['claims'] = [];
  const activities = feature.steps.flatMap((s) =>
    s.attempts.flatMap((a) => a.nativeActivity ?? []),
  );
  for (const image of feature.images ?? [])
    sources.push({
      id: `image:${image.id}`,
      kind: 'image',
      title: image.name,
      at: feature.createdAt,
      origin: 'human',
      content:
        'Capture fournie par l’utilisateur. Elle décrit le besoin, sans prouver à elle seule la cause ou la correction.',
      state: 'observed',
      image,
    });
  for (const step of feature.steps)
    for (const attempt of step.attempts) {
      const stale =
        step.status === 'stale' ||
        attempt.id !== step.attempts.at(-1)?.id ||
        (attempt.descriptionRevision ?? 0) !== (feature.descriptionRevision ?? 0);
      const common = { stepId: step.id, attemptId: attempt.id };
      const add = (entry: ProofEntry) =>
        sources.push({
          ...common,
          ...entry,
          ...(stale
            ? {
                state: 'recheck' as const,
                reason: 'Tentative historique, invalidée ou besoin modifié.',
              }
            : {}),
        });
      for (const message of attempt.pair?.messages ?? [])
        for (const image of message.images ?? [])
          add({
            id: `image:${attempt.id}:${message.id}:${image.id}`,
            kind: 'image',
            title: image.name,
            at: message.at,
            origin: 'human',
            content: `Image du message : ${message.content}\nTransmission : ${message.delivery ?? 'non confirmée'}.`,
            state: message.delivery === 'received' ? 'observed' : 'pending',
            image,
          });
      for (const proof of attempt.evidence ?? []) {
        const id = `test:${attempt.id}:${proof.id}`,
          check = feature.proofChecks?.[id];
        const superseded = (attempt.evidence ?? []).some(
          (p) =>
            p.id !== proof.id &&
            p.commandId === proof.commandId &&
            p.projectId === proof.projectId &&
            p.finishedAt > proof.finishedAt,
        );
        add({
          id,
          kind: 'test',
          title: proof.name,
          at: proof.finishedAt,
          origin: 'runtime',
          content: `${proof.command} ${proof.args.join(' ')}\nCode de retour : ${proof.exitCode ?? 'inconnu'}\n${proof.stdout}\n${proof.stderr}${proof.truncated ? '\nSortie tronquée.' : ''}\nEmpreintes : ${JSON.stringify(proof.fileHashes)}${check ? `\nContrôle ${check.at} : ${check.reason}` : ''}`,
          state:
            superseded || check?.state === 'changed' || check?.state === 'unavailable'
              ? 'recheck'
              : proof.exitCode === 0 && !proof.error
                ? 'observed'
                : 'failed',
          reason: superseded
            ? 'Un test plus récent existe pour cette commande.'
            : check?.state === 'changed' || check?.state === 'unavailable'
              ? check.reason
              : check
                ? check.reason
                : 'Version des fichiers à contrôler avant de réutiliser ce résultat.',
          evidenceId: proof.id,
        });
        for (const attachment of proof.quality?.attachments ?? [])
          add({
            id: `attachment:${attempt.id}:${attachment.id}`,
            kind: 'image',
            title: attachment.name,
            at: proof.quality!.collectedAt,
            origin: 'runtime',
            content: `Pièce de test ${proof.id} · ${attachment.sizeBytes} octets.`,
            state:
              superseded || check?.state === 'changed' || check?.state === 'unavailable'
                ? 'recheck'
                : 'observed',
            digest: attachment.sha256,
            evidenceId: proof.id,
            attachmentId: attachment.id,
          });
      }
      for (const activity of attempt.nativeActivity ?? []) {
        if (activity.tool.startsWith('studio_') && activity.tool.includes('proof')) continue;
        const args = argsOf(activity.arguments),
          url =
            typeof args.url === 'string' && /^https?:\/\//i.test(args.url) ? args.url : undefined;
        const path = typeof args.path === 'string' ? args.path : undefined;
        const kind =
          activity.tool === 'web_fetch' ? 'web' : activity.tool === 'view' ? 'file' : 'activity';
        const laterWrite =
          path &&
          activities.some(
            (a) =>
              a.startedAt > (activity.finishedAt ?? activity.startedAt) &&
              ['edit', 'create', 'apply_patch'].includes(a.tool) &&
              (a.files?.includes(path) ||
                argsOf(a.arguments).path === path ||
                a.tool === 'apply_patch'),
          );
        add({
          id: `runtime:${activity.id}`,
          kind,
          title: url ?? path ?? activity.command ?? activity.tool,
          at: activity.finishedAt ?? activity.startedAt,
          origin: 'runtime',
          content: `Outil : ${activity.tool}\nArguments : ${activity.arguments}\n${activity.output ?? ''}${activity.exitCode !== undefined ? `\nCode de retour : ${activity.exitCode}` : ''}${activity.truncated ? '\nExtrait tronqué.' : ''}`,
          state: laterWrite
            ? 'recheck'
            : activity.status === 'completed'
              ? 'observed'
              : activity.status === 'running'
                ? 'pending'
                : 'failed',
          reason: laterWrite
            ? 'Une écriture a été observée après cette lecture.'
            : kind === 'file'
              ? 'Extrait lu à cette date ; aucune empreinte complète du fichier n’est attestée par cet événement.'
              : kind === 'web'
                ? 'Page consultée à cette date. Sa disponibilité actuelle et la validité des affirmations sont des contrôles distincts.'
                : undefined,
          path,
          url,
        });
      }
      for (const load of attempt.nativeContextLoads ?? [])
        add({
          id: `context:${load.id}`,
          kind: 'context',
          title: load.name,
          at: load.at,
          origin: 'runtime',
          content: `${load.path}\n${load.content}${load.truncated ? '\nExtrait tronqué.' : ''}`,
          state: 'observed',
          digest: load.digest,
        });
      const versions = attempt.artifactVersions ?? [];
      if (attempt.artifact) {
        for (const version of versions.filter((v) => v.revision !== (attempt.revision ?? 0)))
          add({
            id: `report:${attempt.id}:${version.revision}`,
            kind: 'report',
            title: `${step.name} · livrable v${version.revision + 1}`,
            at: version.at,
            origin: version.author === 'human' ? 'human' : 'agent',
            content: version.content,
            state: 'recheck',
            reason: 'Une version plus récente du livrable existe.',
            reportRevision: version.revision,
          });
        add({
          id: `report:${attempt.id}:${attempt.revision ?? 0}`,
          kind: 'report',
          title: `${step.name} · livrable v${(attempt.revision ?? 0) + 1}`,
          at: attempt.artifact.updatedAt,
          origin: versions.at(-1)?.author === 'human' ? 'human' : 'agent',
          reportRevision: attempt.revision ?? 0,
          content: attempt.artifact.content,
          state: 'observed',
          reason: 'Compte rendu : ses affirmations nécessitent leurs propres justificatifs.',
        });
      }
      if (attempt.approvedAt)
        add({
          id: `approval:${attempt.id}:${attempt.approvedAt}`,
          kind: 'approval',
          title: `${step.name} · validation`,
          at: attempt.approvedAt,
          origin: attempt.approvedBy === 'autopilot' ? 'runtime' : 'human',
          content: `Validation ${attempt.approvedBy === 'autopilot' ? 'automatique' : 'humaine'} de la tentative. Elle n’est pas une preuve d’exécution de test.`,
          state: 'observed',
        });
      for (const claim of attempt.proofClaims ?? [])
        claims.push({
          ...claim,
          stepId: step.id,
          attemptId: attempt.id,
          stale: stale || claim.reportRevision !== (attempt.revision ?? 0),
          missingIds: [],
        });
    }
  for (const claim of claims) {
    claim.missingIds = claim.proofIds.filter((id) => !sources.some((s) => s.id === id));
    claim.stale ||=
      claims.some((c) => c.supersedes === claim.id) ||
      claim.missingIds.length > 0 ||
      claim.proofIds.some((id) => sources.some((s) => s.id === id && s.state === 'recheck'));
  }
  return { sources, claims };
}
export function proofDossierMarkdown(feature: Feature): string {
  const dossier = proofDossier(feature);
  return `# Dossier de preuves — ${feature.title}\n\nSession : ${feature.id}\nExport : ${new Date().toISOString()}\n\nUne observation, une conclusion d’agent et une validation humaine sont des éléments distincts.\n\n## Conclusions\n\n${dossier.claims.map((c) => `### ${c.text}\n\n${c.author} · ${c.verdict} · ${c.at} · livrable v${c.reportRevision + 1}${c.stale ? ' · À REVÉRIFIER' : ''}\nSources : ${c.proofIds.join(', ') || 'aucune'}\n`).join('\n')}\n## Sources\n\n${dossier.sources.map((s) => `### ${s.title}\n\nIdentifiant : ${s.id}\nType : ${s.kind} · Origine : ${s.origin} · État : ${s.state} · ${s.at}\n${s.reason ?? ''}\n\n${s.content}\n${s.digest ? `\nSHA-256 : ${s.digest}\n` : ''}${s.image ? '\nImage conservée dans la session ; pixels non inclus dans cet export texte.\n' : ''}`).join('\n')}`;
}
