import type { DevOpsTestTarget } from '../src/shared/devopsKit';
import type { TestEvidence } from '../src/shared/types';

export function DevOpsTestForm({
  value,
  onChange,
}: {
  value?: DevOpsTestTarget;
  onChange: (value: DevOpsTestTarget) => void;
}) {
  const target: DevOpsTestTarget = value ?? {
    buildId: 0,
    pipelineId: 0,
    commit: '',
    branch: '',
    environment: '',
    isolationConfirmed: false,
    expectedStages: [],
    expectedArtifacts: [],
    requireTestResults: true,
  };
  const update = (patch: Partial<DevOpsTestTarget>) => onChange({ ...target, ...patch });
  return (
    <fieldset className="mcp-picker" aria-label="Test DevOps exécuté manuellement">
      <legend>Test DevOps exécuté manuellement</legend>
      <p>
        Après avoir suivi le guide, indique le test à vérifier. L’agent collecte les résultats en
        lecture seule. Le HEAD du workspace doit correspondre au commit testé.
      </p>
      <div className="field-row">
        <label className="field">
          <span>ID du pipeline de test</span>
          <input
            type="number"
            min={1}
            value={target.pipelineId || ''}
            onChange={(e) => update({ pipelineId: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>ID de l’exécution (build)</span>
          <input
            type="number"
            min={1}
            value={target.buildId || ''}
            onChange={(e) => update({ buildId: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="field">
        <span>Commit testé (SHA complet)</span>
        <input
          value={target.commit}
          placeholder="40 caractères hexadécimaux"
          onChange={(e) => update({ commit: e.target.value.trim().toLowerCase() })}
        />
      </label>
      <label className="field">
        <span>Branche testée</span>
        <input
          value={target.branch}
          placeholder="refs/heads/test/devops"
          onChange={(e) => update({ branch: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Cible de test et isolation mise en place</span>
        <textarea
          rows={3}
          value={target.environment}
          placeholder="Ressources dédiées, connexion utilisée, déclencheurs vérifiés…"
          onChange={(e) => update({ environment: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Stages attendus (séparés par une virgule)</span>
        <input
          value={target.expectedStages.join(', ')}
          placeholder="Validate, Integration"
          onChange={(e) =>
            update({ expectedStages: e.target.value.split(',').map((v) => v.trim()) })
          }
        />
        <small>Identifiants ou noms exacts du guide. Un stage ignoré bloque la validation.</small>
      </label>
      <label className="field">
        <span>Artefacts attendus (facultatif)</span>
        <input
          value={target.expectedArtifacts.join(', ')}
          placeholder="validation-report"
          onChange={(e) =>
            update({
              expectedArtifacts: e.target.value
                ? e.target.value.split(',').map((v) => v.trim())
                : [],
            })
          }
        />
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={target.requireTestResults}
          onChange={(e) => update({ requireTestResults: e.target.checked })}
        />
        <span>Exiger des résultats de tests publiés dans Azure DevOps</span>
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={target.isolationConfirmed}
          onChange={(e) => update({ isolationConfirmed: e.target.checked })}
        />
        <span>J’ai mis en place et exécuté ce test hors production selon le guide</span>
      </label>
      <small>
        Cette déclaration est humaine. La réussite d’un pipeline ne prouve pas à elle seule
        l’absence d’impact sur la production.
      </small>
    </fieldset>
  );
}

export function DevOpsEvidencePanel({ evidence }: { evidence: TestEvidence[] }) {
  const reports = evidence.filter((proof) => proof.devops);
  if (!reports.length) return null;
  return (
    <section className="quality-panel" aria-label="Vérification du test DevOps">
      <h3>Vérification du test DevOps</h3>
      {reports.map((proof) => {
        const report = proof.devops!;
        return (
          <article key={proof.id} className="quality-report">
            <strong>
              {report.status === 'passed'
                ? 'Contrôles techniques réussis'
                : report.status === 'incomplete'
                  ? 'Collecte incomplète'
                  : 'Contrôles non satisfaits'}{' '}
              · build #{report.target.buildId}
            </strong>
            <p>
              {report.projectKey} · pipeline {report.target.pipelineId} ·{' '}
              {new Date(report.collectedAt).toLocaleString('fr-FR')}
            </p>
            <p>
              Commit <code>{report.target.commit}</code> · {report.target.branch}
            </p>
            <p>Isolation déclarée par l’humain : {report.target.environment}</p>
            <ul>
              {report.checks.map((check, index) => (
                <li key={index}>
                  <strong>
                    {check.passed ? '✓' : '✗'} {check.name}
                  </strong>{' '}
                  — {check.detail}
                </li>
              ))}
            </ul>
            <details>
              <summary>Sources collectées</summary>
              <ul>
                {report.observations.map((observation, index) => (
                  <li key={index}>
                    <code>{observation.sourceUrl}</code> · {observation.collectedAt}
                    {observation.truncated ? ' · incomplet' : ''}
                  </li>
                ))}
              </ul>
            </details>
            <p>
              Les contrôles portent sur les références et résultats déclarés. Les droits Azure,
              cibles déployées et contenus d’artefacts demandent leurs propres preuves.
            </p>
          </article>
        );
      })}
    </section>
  );
}
