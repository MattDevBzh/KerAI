import { nativeTestSnapshot } from './NativeTestEvidence';
import { readFile } from 'node:fs/promises';
import { currentOwnedFileHashes } from '../core/ownership';
import { proofProposalSchema } from '../core/proofSchemas';
import { currentTestEvidence } from '../core/validation';
import type { NavigationCapture } from '../shared/navigation';
import type { ProofClaim } from '../shared/proofs';
import { proofDossier } from '../shared/proofs';
import type { Feature } from '../shared/types';
import { PolicyEngine, sha256 } from './PolicyEngine';
import { gitRead } from './gitRead';
import { redact } from './process';

interface ProofPaths {
  featurePath(featureId: string): Promise<string>;
  fileLocation(featureId: string, file: string): Promise<{ root: string; path: string }>;
}

export async function verifyProofFiles(
  feature: Feature,
  related: Set<string>,
  paths: ProofPaths,
): Promise<void> {
  const root = await paths.featurePath(feature.id);
  const policies = new Map<string, PolicyEngine>();
  const resolveFile = async (file: string): Promise<string> => {
    const target = await paths.fileLocation(feature.id, file);
    let policy = policies.get(target.root);
    if (!policy) {
      policy = new PolicyEngine(target.root, 'read-only', []);
      policies.set(target.root, policy);
    }
    return policy.resolve(target.path);
  };
  const ownedPaths = new Set<string>();
  for (const step of feature.steps.filter((item) => related.has(item.id))) {
    for (const historical of step.attempts)
      for (const file of Object.keys(historical.fileHashes ?? {})) ownedPaths.add(file);
    const attempt = step.attempts.at(-1);
    if (!attempt) continue;
    const proofs = currentTestEvidence(attempt);
    for (const evidence of proofs) {
      if (evidence.native) {
        const snapshot = await nativeTestSnapshot(
          root,
          feature.projects?.map((project, index) => ({
            id: project.id,
            path: index === 0 ? root : project.path,
          })),
        );
        if (snapshot.digest !== evidence.native.snapshot)
          throw new Error(
            'La preuve native est obsolète : les fichiers ou le commit ont changé. Relance les tests.',
          );
      }
      if (evidence.devops) {
        const proofRoot = evidence.projectId
          ? feature.projects?.find((project) => project.id === evidence.projectId)?.path
          : root;
        if (!proofRoot) throw new Error('Projet de preuve inconnu.');
        const head = await gitRead(proofRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], {
          rawOutput: true,
        });
        if (
          head.code !== 0 ||
          head.truncated ||
          head.stdout.trim() !== evidence.devops.target.commit
        )
          throw new Error(
            'Le commit local a changé depuis la vérification du test DevOps. Relance la validation.',
          );
      }
    }
    const snapshots = proofs.filter((proof) => !proof.native).map((proof) => proof.fileHashes);
    for (const hashes of snapshots)
      for (const [file, hash] of Object.entries(hashes)) {
        let current = '<missing>';
        try {
          current = sha256(await readFile(await resolveFile(file)));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (current !== hash)
          throw new Error(
            `La preuve de test est obsolète : ${file} a changé. Relance les tests avant validation.`,
          );
      }
  }
  if (feature.steps.every((step) => related.has(step.id)))
    for (const file of Object.keys(feature.workspaceFileHashes ?? {})) ownedPaths.add(file);
  const owned = currentOwnedFileHashes(feature, ownedPaths);
  for (const file of ownedPaths) {
    let current = '<missing>';
    try {
      current = sha256(await readFile(await resolveFile(file)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (current !== owned[file])
      throw new Error(
        `La preuve de test est obsolète : ${file} a changé hors de la dernière écriture autorisée de la feature. Relance son étape avant validation.`,
      );
  }
}
export function checkedProofClaim(
  feature: Feature,
  value: Pick<ProofClaim, 'text' | 'proofIds' | 'verdict'>,
  id: string,
  author: ProofClaim['author'],
  reportRevision: number,
): ProofClaim {
  const proposal = proofProposalSchema.parse(value),
    sources = proofDossier(feature).sources;
  if (proposal.verdict !== 'unverified' && !proposal.proofIds.length)
    throw Error('Associe au moins une preuve ou indique « Non vérifié ».');
  if (proposal.proofIds.some((id) => !sources.some((s) => s.id === id)))
    throw Error('Une preuve référencée est absente du dossier.');
  if (
    proposal.verdict === 'supported' &&
    proposal.proofIds.some((id) => sources.some((s) => s.id === id && s.state !== 'observed'))
  )
    throw Error('Une preuve est en attente, en échec ou à revérifier.');
  return {
    ...proposal,
    text: redact(proposal.text),
    proofIds: [...new Set(proposal.proofIds)],
    id,
    author,
    at: new Date().toISOString(),
    reportRevision,
  };
}
/** Read-only inspection. The caller owns the state/revision check and persistence. */
export async function inspectProofDossier(
  feature: Feature,
  paths: ProofPaths,
  verifyCapture: (capture: NavigationCapture) => Promise<unknown>,
): Promise<NonNullable<Feature['proofChecks']>> {
  const checks: NonNullable<Feature['proofChecks']> = {};
  for (const step of feature.steps)
    for (const attempt of step.attempts)
      for (const proof of attempt.evidence ?? []) {
        const id = `test:${attempt.id}:${proof.id}`;
        const changed: string[] = [];
        let unavailable = '';
        for (const [file, expected] of Object.entries(proof.fileHashes))
          try {
            const target = await paths.fileLocation(feature.id, file);
            const policy = new PolicyEngine(target.root, 'read-only', []);
            const actual = sha256(await readFile(await policy.resolve(target.path)));
            if (actual !== expected) changed.push(file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') changed.push(file);
            else unavailable = (error as Error).message;
          }
        checks[id] = {
          at: new Date().toISOString(),
          state: changed.length
            ? 'changed'
            : unavailable || !Object.keys(proof.fileHashes).length
              ? 'unavailable'
              : 'unchanged',
          reason: changed.length
            ? `Fichiers modifiés depuis le test : ${changed.join(', ')}`
            : unavailable ||
              (!Object.keys(proof.fileHashes).length
                ? 'Aucune empreinte de fichier dans cette preuve.'
                : 'Les fichiers dont une empreinte a été enregistrée sont inchangés à cette date. Le test n’a pas été relancé.'),
        };
      }
  for (const step of feature.steps)
    for (const attempt of step.attempts)
      for (const capture of attempt.navigationCaptures ?? []) {
        const id = `navigation-capture:${attempt.id}:${capture.id}`;
        try {
          await verifyCapture(capture);
          checks[id] = {
            at: new Date().toISOString(),
            state: 'unchanged',
            reason:
              'Capture privée et empreinte intactes ; le parcours et les critères métier n’ont pas été rejoués.',
          };
        } catch (error) {
          checks[id] = {
            at: new Date().toISOString(),
            state: 'unavailable',
            reason: (error as Error).message,
          };
        }
      }
  return checks;
}
