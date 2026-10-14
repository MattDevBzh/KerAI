import { expect, it } from 'vitest';
import { sessionMarkdown } from '../src/shared/sessionExport';
import { WorkflowEngine } from '../src/core/workflow';

it('exports the original report, human revisions and final decision without replacing missing usage with zero', () => {
  const engine = new WorkflowEngine();
  const feature = engine.createFeature(
    {
      id: 'single',
      name: 'Session',
      description: '',
      icon: '',
      steps: [
        {
          id: 'run',
          name: 'Rapport',
          description: '',
          agentId: 'agent',
          policy: 'read-only',
          skills: [],
          maxAttempts: 3,
          artifact: 'report.md',
          dependsOn: [],
        },
      ],
    },
    { title: 'Décision corrigée', description: 'Demande actuelle' },
  );
  engine.beginRun(feature.id, 'run');
  engine.finishRun(feature.id, 'run', { content: 'Ancien choix', questions: [], changedFiles: [] });
  engine.saveArtifact(feature.id, 'run', 'Choix corrigé');
  const attempt = feature.steps[0].attempts[0];
  attempt.usage = { source: 'measured', inputTokens: 20 };
  engine.approveStep(feature.id, 'run');
  feature.finalValidation = { id: 'final', at: '2026-10-14', stateKey: '', author: 'human' };
  const text = sessionMarkdown(feature, '/repo');
  expect(text).toContain('Ancien choix');
  expect(text).toContain('Choix corrigé');
  expect(text).toContain('révision 0');
  expect(text).toContain('révision 1');
  expect(text).toContain('Validation définitive humaine : 2026-10-14');
  expect(text).toContain('sortie : inconnus');
});
