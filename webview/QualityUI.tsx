import type { TestEvidence } from '../src/shared/types';
import type { QualityCommandConfig } from '../src/shared/quality';
import './QualityUI.css';

const statuses = {
  passed: 'Parcours réussis',
  failed: 'Échec observé',
  skipped: 'Non exécuté',
  incomplete: 'Preuves incomplètes',
  unavailable: 'Rapport absent',
  invalid: 'Rapport invalide',
};
export function QualitySetup({
  onInstall,
  disabled = false,
}: {
  onInstall: () => void;
  disabled?: boolean;
}) {
  return (
    <aside className="quality-empty quality-setup">
      <strong>Préparer les parcours Playwright</strong>
      <p>
        Installe le reporter local, ajoute-le à ta configuration Playwright, puis déclare ci-dessous
        la commande exacte autorisée. Le dépôt doit déjà disposer de Playwright et de son
        navigateur.
      </p>
      <button
        type="button"
        className="button secondary small"
        disabled={disabled}
        onClick={onInstall}
      >
        Installer le reporter qualité
      </button>
      <p>
        <code>reporter: [['list'], ['./.feature-studio/quality-kit/playwright-reporter.cjs']]</code>
      </p>
      <p>
        Capture et trace :{' '}
        <code>
          use: {'{'} screenshot: 'on', trace: 'on' {'}'}
        </code>
        . Guide installé dans <code>.feature-studio/quality-kit/README.md</code>.
      </p>
    </aside>
  );
}
export function QualityPanel({
  evidence,
  onOpenAttachment,
  mediaUris = {},
}: {
  evidence: TestEvidence[];
  onOpenAttachment: (evidenceId: string, attachmentId: string) => void;
  /** Only host-generated asWebviewUri URLs for verified private PNG/JPEG copies. */
  mediaUris?: Record<string, string>;
}) {
  const reports = evidence.filter((item) => item.quality);
  return (
    <section className="quality-panel" aria-label="Recette et contre-exemples">
      <header>
        <h3>Recette et contre-exemples</h3>
        <p>Parcours réels, preuves de la commande et validation humaine des critères.</p>
      </header>
      {!reports.length && (
        <div className="quality-empty">
          <strong>Aucune recette collectée</strong>
          <p>
            Configure une commande de tests avec un rapport qualité, puis lance l’agent Recette
            visuelle ou Chasseur de contre-exemples.
          </p>
        </div>
      )}
      {reports.map((proof) => {
        const quality = proof.quality!;
        return (
          <article className="quality-report" key={proof.id}>
            <div className="quality-report-heading">
              <strong>
                {quality.kind === 'visual' ? 'Recette visuelle' : 'Contre-exemples'} · {proof.name}
              </strong>
              <span className={`quality-verdict ${quality.status}`}>
                {statuses[quality.status]}
              </span>
            </div>
            <p className="quality-provenance">
              Tentative {quality.attemptId} · {quality.runner ?? 'Runner indisponible'} ·{' '}
              {new Date(quality.collectedAt).toLocaleString('fr-FR')}
            </p>
            <details>
              <summary>Commande autorisée et provenance</summary>
              <code>{[proof.command, ...proof.args].join(' ')}</code>
              <p>Rapport : {quality.reportPath}</p>
              <p>
                Preuve : <code>{proof.id}</code>
              </p>
              <p>
                Code retour : {proof.exitCode ?? 'inconnu'} · Empreintes :{' '}
                {Object.keys(proof.fileHashes).length} fichiers
              </p>
              <p>
                SHA-256 du rapport : <code>{quality.reportSha256 ?? 'indisponible'}</code>
              </p>
            </details>
            {(quality.error || proof.error) && (
              <p className="quality-error" role="alert">
                {quality.error || proof.error}
              </p>
            )}
            {!quality.cases.length && (
              <p>Aucun parcours valide à présenter. Ce résultat ne valide aucun critère.</p>
            )}
            {quality.cases.map((test) => (
              <details className="quality-case" key={test.id} open={test.status === 'failed'}>
                <summary>
                  <span className={`quality-verdict ${test.status}`}>{statuses[test.status]}</span>{' '}
                  {test.title}
                </summary>
                <p>
                  Critères :{' '}
                  {test.criterionIds.length ? test.criterionIds.join(', ') : 'aucun lien renseigné'}
                </p>
                {test.expected && (
                  <p>
                    <strong>Attendu :</strong> {test.expected}
                  </p>
                )}
                {test.actual && (
                  <p>
                    <strong>Observé :</strong> {test.actual}
                  </p>
                )}
                {test.steps.length > 0 && (
                  <ol>
                    {test.steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                )}
                {test.errors.map((error, index) => (
                  <pre className="quality-error" key={index}>
                    {error}
                  </pre>
                ))}
                {!!test.reproduction?.length && (
                  <div>
                    <strong>Reproduire</strong>
                    <ol>
                      {test.reproduction.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <div className="quality-media">
                  {test.attachmentIds.map((id) => {
                    const attachment = quality.attachments.find((item) => item.id === id);
                    if (!attachment) return null;
                    const uri = mediaUris[`${proof.id}:${id}`];
                    return (
                      <figure key={id}>
                        {uri && attachment.kind === 'screenshot' && (
                          <img src={uri} alt={attachment.name} loading="lazy" />
                        )}
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => onOpenAttachment(proof.id, id)}
                        >
                          {attachment.kind === 'trace' ? 'Enregistrer la trace' : 'Voir la capture'}{' '}
                          : {attachment.name}
                        </button>
                        <figcaption>
                          {Math.ceil(attachment.sizeBytes / 1024)} Kio ·{' '}
                          <code>{attachment.sha256.slice(0, 12)}</code>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
                <p className="quality-proof-ref">
                  Référence pour l’acceptation :{' '}
                  <code>
                    {proof.id}/{test.id}
                  </code>
                </p>
              </details>
            ))}
            <p className="quality-human-note">
              Ces résultats ne changent pas automatiquement les critères d’acceptation. Relis les
              preuves puis référence leur identifiant dans la validation humaine.
            </p>
          </article>
        );
      })}
    </section>
  );
}

export function QualityCommandFields({
  config,
  onChange,
  disabled = false,
}: {
  config?: QualityCommandConfig;
  onChange: (config: QualityCommandConfig | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="quality-command-fields">
      <label>
        Collecte de preuves
        <select
          disabled={disabled}
          value={config?.kind ?? ''}
          onChange={(event) =>
            onChange(
              event.target.value
                ? {
                    kind: event.target.value as QualityCommandConfig['kind'],
                    reportPath: config?.reportPath ?? '.feature-studio/quality/report.json',
                  }
                : undefined,
            )
          }
        >
          <option value="">Tests classiques</option>
          <option value="visual">Recette visuelle (Playwright)</option>
          <option value="counterexample">Contre-exemples</option>
        </select>
      </label>
      {config && (
        <>
          <label>
            Rapport JSON approuvé
            <input
              disabled={disabled}
              value={config.reportPath}
              onChange={(event) => onChange({ ...config, reportPath: event.target.value })}
              placeholder=".feature-studio/quality/report.json"
            />
          </label>
          <small>
            Reporter Feature Studio requis. Captures PNG/JPEG et traces copiées dans le stockage
            privé. Rapport absent ou ancien = validation bloquée.
          </small>
        </>
      )}
    </div>
  );
}
