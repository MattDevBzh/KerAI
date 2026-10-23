import { useState } from 'react';
import type { StudioState } from '../src/shared/types';
import {
  evaluationAttempts,
  evaluationPhaseLabels,
  evaluationRefKey,
  evaluationTimeLabels,
  type NavigationCampaign,
  type NavigationCampaignDefinition,
  type NavigationEvaluationCommand,
  type NavigationEvaluationInput,
  type NavigationEvaluationSnapshot,
  type EvaluationMetric,
} from '../src/shared/navigationEvaluation';
import { StudioDialog } from './ExecutionUI';
import './navigation-evaluation.css';
const newId = () => crypto.randomUUID();
const metricLabels: Record<EvaluationMetric, string> = {
  tokens: 'Tokens entrée + sortie',
  cost: 'Consommation fournisseur',
  activeSeconds: 'Temps actif déclaré',
  totalSeconds: 'Temps total déclaré',
};
const configurationLabels: Record<keyof NavigationEvaluationInput['configuration'], string> = {
  model: 'Modèle effectif',
  runtime: 'Version du runtime',
  permissions: 'Permissions',
  build: 'Snapshot de code initial',
  dataSnapshot: 'Snapshot de données initial',
  criteria: 'Critères d’acceptation',
  role: 'Rôle utilisateur',
  catalogueSnapshot: 'Snapshot initial de bibliothèque',
  indexSnapshot: 'Snapshot initial d’index',
};
const percent = (value: number | null) =>
  value === null
    ? 'Non établi'
    : `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const display = (value: { value: number | null; unit?: string }) =>
  value.value === null
    ? 'Inconnu'
    : `${value.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${value.unit ?? ''}`;
type Send = (command: NavigationEvaluationCommand, onSuccess?: () => void) => void;
export function NavigationEvaluationUI({
  snapshot,
  state,
  send,
  error,
  busy,
}: {
  snapshot?: NavigationEvaluationSnapshot;
  state: StudioState;
  send: Send;
  error?: string;
  busy: boolean;
}) {
  const [id, setId] = useState('');
  const [campaignEditor, setCampaignEditor] = useState<NavigationCampaignDefinition>();
  const [entryEditor, setEntryEditor] = useState<NavigationEvaluationInput>();
  const campaigns = snapshot?.campaigns ?? [];
  const campaign = campaigns.find((c) => c.id === id) ?? campaigns[0];
  const report = campaign ? snapshot?.reports[campaign.id] : undefined;
  const create = () =>
    setCampaignEditor({
      id: newId(),
      name: '',
      profile: '',
      tickets: [],
      repetitions: 1,
      phases: ['analysis', 'development', 'verification'],
    });
  const newEntry = (source?: NavigationEvaluationInput) =>
    setEntryEditor({
      id: newId(),
      condition: source?.condition ?? 'A',
      ticketId: source?.ticketId ?? campaign?.tickets[0]?.id,
      repetition: source?.repetition ?? 1,
      order: (campaign?.entries.length ?? 0) + 1,
      phase: source?.phase ?? campaign?.phases[0] ?? 'analysis',
      outcome: 'succeeded',
      qualityAccepted: false,
      attemptRefs: [],
      providerMode: 'unknown',
      times: {},
      configuration: source?.configuration ?? {
        model: '',
        runtime: '',
        permissions: '',
        build: '',
        dataSnapshot: '',
        criteria: '',
        role: '',
        catalogueSnapshot: '',
        indexSnapshot: '',
      },
    });
  return (
    <section className="navigation-evaluation" aria-label="Journal de campagne A et B">
      <details>
        <summary>Évaluer la qualité, le temps et la consommation</summary>
        <p>
          Comparez les mêmes tickets avec et sans bibliothèque. Les temps sont déclarés manuellement
          ; les usages liés viennent des tentatives réelles, y compris celles sans navigation.
          Aucune campagne ne lance un agent.
        </p>
        <div className="applications-actions">
          <button onClick={create}>Créer une campagne A/B</button>
          <button disabled={busy} onClick={() => send({ action: 'evaluationLoad' })}>
            Actualiser le journal
          </button>
        </div>
        {!campaign ? (
          <p className="muted">
            Aucune campagne. Le protocole exige des critères identiques, des snapshots initiaux
            comparables et le coût d’apprentissage et d’entretien.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Campagne</span>
              <select value={campaign.id} onChange={(event) => setId(event.target.value)}>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="applications-section-heading">
              <div>
                <h3>{campaign.name}</h3>
                <p>{campaign.profile}</p>
                <small>
                  {campaign.tickets.length} ticket(s) · {campaign.repetitions} répétition(s)
                  indépendantes
                </small>
              </div>
              <div className="applications-actions">
                <button
                  onClick={() => {
                    const { entries, createdAt, updatedAt, ...definition } = campaign;
                    setCampaignEditor(definition);
                  }}
                >
                  Configurer la campagne
                </button>
                <button className="primary" onClick={() => newEntry()}>
                  Ajouter une mesure
                </button>
                <button
                  onClick={() => send({ action: 'evaluationExport', campaignId: campaign.id })}
                >
                  Aperçu d’export de campagne
                </button>
              </div>
            </div>
            {report && (
              <>
                <p>
                  {report.entries} entrée(s) · {report.failures} échec(s), blocage(s) ou
                  annulation(s), tentatives intermédiaires incluses et conservées dans les totaux ·{' '}
                  {report.unknownTimes} durée(s) inconnue(s).
                </p>
                <div className="evaluation-metrics">
                  {(Object.keys(metricLabels) as EvaluationMetric[]).map((metric) => {
                    const row = report.metrics[metric];
                    return (
                      <article key={metric}>
                        <h4>{metricLabels[metric]}</h4>
                        <dl>
                          <dt>Total A, échecs inclus</dt>
                          <dd>{display(row.totalA)}</dd>
                          <dt>Total B, apprentissage et entretien inclus</dt>
                          <dd>{display(row.totalB)}</dd>
                          <dt>Paires admissibles</dt>
                          <dd>
                            {row.admissiblePairs} / {report.plannedPairs}
                          </dd>
                          <dt>Médiane des gains appariés admissibles</dt>
                          <dd>{percent(row.medianPairedGain)}</dd>
                          <dt>Gain cumulé complet</dt>
                          <dd>{percent(row.cumulativeGain)}</dd>
                        </dl>
                        {row.cumulativeReasons.length > 0 && (
                          <p className="field-help">{row.cumulativeReasons.join(' ')}</p>
                        )}
                        <p className="field-help">
                          Un résultat sur un sous-ensemble ne démontre pas le gain de la campagne
                          entière.
                        </p>
                        {row.breakEven.map((sequence) => (
                          <p className="field-help" key={sequence.repetition}>
                            Répétition {sequence.repetition} :{' '}
                            {sequence.firstUse === null
                              ? 'amortissement non établi'
                              : `premier croisement à ${sequence.firstUse} utilisation(s)`}
                            {sequence.reversed ? ' · annulé par les coûts ultérieurs' : ''} · bilan
                            final {percent(sequence.finalGain)}
                          </p>
                        ))}
                      </article>
                    );
                  })}
                </div>
                <details>
                  <summary>Admissibilité et exclusions des paires</summary>
                  {report.comparisons.map((pair) => (
                    <article
                      className="applications-run"
                      key={`${pair.ticketId}-${pair.repetition}`}
                    >
                      <strong>
                        {campaign.tickets.find((ticket) => ticket.id === pair.ticketId)?.label} ·
                        répétition {pair.repetition}
                      </strong>
                      {(Object.keys(metricLabels) as EvaluationMetric[]).map((metric) => (
                        <p key={metric}>
                          <strong>{metricLabels[metric]} :</strong>{' '}
                          {pair.metrics[metric].eligible
                            ? `admissible · gain ${percent(pair.metrics[metric].gain)}`
                            : pair.metrics[metric].reasons.join(' ')}
                        </p>
                      ))}
                    </article>
                  ))}
                </details>
              </>
            )}
            <h4>Journal exact</h4>
            {!campaign.entries.length ? (
              <p>Aucune mesure enregistrée.</p>
            ) : (
              <div className="evaluation-entries">
                {[...campaign.entries]
                  .sort((a, b) => a.repetition - b.repetition || a.order - b.order)
                  .map((entry) => (
                    <article className="applications-run" key={entry.id}>
                      <strong>
                        {entry.condition} · {evaluationPhaseLabels[entry.phase]} ·{' '}
                        {campaign.tickets.find((ticket) => ticket.id === entry.ticketId)?.label ??
                          'Coût transversal'}
                      </strong>
                      <p>
                        Répétition {entry.repetition} · ordre {entry.order} ·{' '}
                        {
                          {
                            succeeded: 'Réussite',
                            failed: 'Échec',
                            blocked: 'Bloqué',
                            cancelled: 'Annulé',
                          }[entry.outcome]
                        }{' '}
                        · {entry.qualityAccepted ? 'qualité acceptée' : 'qualité à valider'}
                      </p>
                      <p>
                        {entry.receipts.length} tentative(s) liée(s) ·{' '}
                        {entry.providerMode === 'none-declared'
                          ? 'Absence d’appel déclarée'
                          : entry.providerMode === 'unknown'
                            ? 'Usage fournisseur inconnu'
                            : 'Usages reçus figés par l’hôte'}
                      </p>
                      <details>
                        <summary>Durées déclarées et contexte de cette mesure</summary>
                        <dl>
                          {Object.entries(evaluationTimeLabels).map(([key, label]) => (
                            <div key={key}>
                              <dt>{label}</dt>
                              <dd>
                                {entry.times[key as keyof typeof evaluationTimeLabels] === undefined
                                  ? 'Inconnu'
                                  : `${entry.times[key as keyof typeof evaluationTimeLabels]} s`}
                              </dd>
                            </div>
                          ))}
                          {Object.entries(configurationLabels).map(([key, label]) => (
                            <div key={key}>
                              <dt>{label}</dt>
                              <dd>
                                {entry.configuration[key as keyof typeof configurationLabels] ||
                                  'Inconnu'}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                      {entry.observations && <p>{entry.observations}</p>}
                      <div className="applications-actions">
                        <button
                          onClick={() => {
                            const { receipts, savedAt, ...input } = entry;
                            setEntryEditor(input);
                          }}
                        >
                          Corriger la mesure
                        </button>
                        <button onClick={() => newEntry(entry)}>Réutiliser ce contexte</button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            send({
                              action: 'evaluationDeleteEntry',
                              campaignId: campaign.id,
                              entryId: entry.id,
                            })
                          }
                        >
                          Retirer cette mesure
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            )}
            <p className="field-help">
              L’export conserve les nombres exacts, les échecs, la couverture et les exclusions. Les
              noms, chemins, URL, observations libres et captures restent locaux ; les références
              sont remplacées par des identifiants opaques.
            </p>
          </>
        )}
      </details>
      {campaignEditor && (
        <CampaignEditor
          value={campaignEditor}
          error={error}
          busy={busy}
          close={() => setCampaignEditor(undefined)}
          save={(definition) =>
            send({ action: 'evaluationSaveCampaign', campaign: definition }, () => {
              setId(definition.id);
              setCampaignEditor(undefined);
            })
          }
        />
      )}
      {entryEditor && campaign && (
        <EntryEditor
          value={entryEditor}
          campaign={campaign}
          state={state}
          error={error}
          busy={busy}
          close={() => setEntryEditor(undefined)}
          save={(entry) =>
            send({ action: 'evaluationSaveEntry', campaignId: campaign.id, entry }, () =>
              setEntryEditor(undefined),
            )
          }
        />
      )}
    </section>
  );
}
function CampaignEditor({
  value: initial,
  error,
  busy,
  close,
  save,
}: {
  value: NavigationCampaignDefinition;
  error?: string;
  busy: boolean;
  close: () => void;
  save: (value: NavigationCampaignDefinition) => void;
}) {
  const [value, setValue] = useState(initial);
  const [tickets, setTickets] = useState(initial.tickets.map((ticket) => ticket.label).join('\n'));
  return (
    <StudioDialog
      title="Campagne comparative A/B"
      subtitle="A : moyens habituels, B : mêmes moyens avec bibliothèque. Aucun appel fournisseur."
      onClose={close}
      className="applications-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save({
            ...value,
            tickets: tickets
              .split('\n')
              .map((label) => label.trim())
              .filter(Boolean)
              .map(
                (label) =>
                  initial.tickets.find((ticket) => ticket.label === label) ?? {
                    id: newId(),
                    label,
                  },
              ),
          });
        }}
      >
        {error && <p role="alert">{error}</p>}
        <label className="field">
          <span>Nom de campagne</span>
          <input
            required
            value={value.name}
            onChange={(event) => setValue({ ...value, name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Profil et périmètre local</span>
          <textarea
            rows={2}
            value={value.profile}
            onChange={(event) => setValue({ ...value, profile: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Tickets comparables (un par ligne)</span>
          <textarea
            rows={5}
            required
            value={tickets}
            onChange={(event) => setTickets(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Répétitions indépendantes</span>
          <input
            type="number"
            min={1}
            max={10}
            required
            value={value.repetitions}
            onChange={(event) => setValue({ ...value, repetitions: Number(event.target.value) })}
          />
        </label>
        <fieldset>
          <legend>Phases attendues pour chaque ticket en A et B</legend>
          {(['analysis', 'development', 'verification'] as const).map((phase) => (
            <label className="applications-check" key={phase}>
              <input
                type="checkbox"
                checked={value.phases.includes(phase)}
                onChange={(event) =>
                  setValue({
                    ...value,
                    phases: event.target.checked
                      ? [...value.phases, phase]
                      : value.phases.filter((item) => item !== phase),
                  })
                }
              />
              {evaluationPhaseLabels[phase]}
            </label>
          ))}
        </fieldset>
        <p className="field-help">
          Chaque répétition repart du même catalogue et index initial. L’apprentissage et
          l’entretien ont leurs propres entrées ; les répétitions ne comptent pas comme de nouvelles
          utilisations pour l’amortissement.
        </p>
        <div className="applications-actions">
          <button type="button" onClick={close}>
            Annuler
          </button>
          <button className="primary" disabled={busy || !value.phases.length} type="submit">
            Enregistrer la campagne
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
function EntryEditor({
  value: initial,
  campaign,
  state,
  error,
  busy,
  close,
  save,
}: {
  value: NavigationEvaluationInput;
  campaign: NavigationCampaign;
  state: StudioState;
  error?: string;
  busy: boolean;
  close: () => void;
  save: (value: NavigationEvaluationInput) => void;
}) {
  const [value, setValue] = useState(initial);
  const patch = (patch: Partial<NavigationEvaluationInput>) => setValue({ ...value, ...patch });
  const [search, setSearch] = useState('');
  const attempts = evaluationAttempts(state.features);
  const occupied = new Set(
    campaign.entries
      .filter((row) => row.id !== value.id)
      .flatMap((row) => row.attemptRefs.map(evaluationRefKey)),
  );
  return (
    <StudioDialog
      title="Mesure de campagne"
      subtitle="Les champs vides restent inconnus. Saisissez 0 uniquement pour une durée réellement nulle."
      onClose={close}
      className="applications-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(value);
        }}
      >
        {error && <p role="alert">{error}</p>}
        <div className="applications-form-grid">
          <label className="field">
            <span>Condition</span>
            <select
              value={value.condition}
              onChange={(event) => patch({ condition: event.target.value as 'A' | 'B' })}
            >
              <option value="A">A · moyens habituels</option>
              <option value="B">B · avec bibliothèque</option>
            </select>
          </label>
          <label className="field">
            <span>Ticket mesuré</span>
            <select
              value={value.ticketId ?? ''}
              onChange={(event) => patch({ ticketId: event.target.value || undefined })}
            >
              <option value="">Coût transversal</option>
              {campaign.tickets.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Phase</span>
            <select
              value={value.phase}
              onChange={(event) =>
                patch({ phase: event.target.value as NavigationEvaluationInput['phase'] })
              }
            >
              {Object.entries(evaluationPhaseLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Répétition</span>
            <input
              type="number"
              min={1}
              max={campaign.repetitions}
              value={value.repetition}
              onChange={(event) => patch({ repetition: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>Ordre dans la séquence</span>
            <input
              type="number"
              min={0}
              value={value.order}
              onChange={(event) => patch({ order: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>Résultat</span>
            <select
              value={value.outcome}
              onChange={(event) =>
                patch({ outcome: event.target.value as NavigationEvaluationInput['outcome'] })
              }
            >
              <option value="succeeded">Réussite</option>
              <option value="failed">Échec</option>
              <option value="blocked">Bloqué</option>
              <option value="cancelled">Annulé</option>
            </select>
          </label>
        </div>
        <label className="applications-check">
          <input
            type="checkbox"
            checked={value.qualityAccepted}
            onChange={(event) => patch({ qualityAccepted: event.target.checked })}
          />{' '}
          Qualité acceptée selon les mêmes critères, sans vérification supprimée
        </label>
        <fieldset>
          <legend>Temps déclarés manuellement, en secondes</legend>
          <p className="field-help">
            Mesures exclusives : ne comptez pas deux fois la même durée. Le temps actif inclut
            préparation, connexion, démonstration et travail ; le total ajoute l’attente humaine.
          </p>
          <div className="applications-form-grid">
            {Object.entries(evaluationTimeLabels).map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label} (s)</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={value.times[key as keyof typeof evaluationTimeLabels] ?? ''}
                  placeholder="Inconnu"
                  onChange={(event) =>
                    patch({
                      times: {
                        ...value.times,
                        [key]: event.target.value === '' ? undefined : Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Usages fournisseur</legend>
          <label className="field">
            <span>Origine de la mesure fournisseur</span>
            <select
              value={value.providerMode}
              onChange={(event) =>
                patch({
                  providerMode: event.target.value as NavigationEvaluationInput['providerMode'],
                  attemptRefs: [],
                })
              }
            >
              <option value="unknown">Inconnue · ne pas compter comme zéro</option>
              <option value="linked-attempts">Lier les tentatives du registre</option>
              <option value="none-declared">Aucun appel fournisseur · déclaration explicite</option>
            </select>
          </label>
          {value.providerMode === 'linked-attempts' && (
            <>
              <label className="field">
                <span>Rechercher une tentative, avec ou sans navigation</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="evaluation-attempts">
                {attempts
                  .filter((attempt) =>
                    attempt.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                  )
                  .map((attempt) => {
                    const key = evaluationRefKey(attempt.ref);
                    return (
                      <label className="applications-check" key={key}>
                        <input
                          type="checkbox"
                          disabled={attempt.status === 'running' || occupied.has(key)}
                          checked={value.attemptRefs.some((ref) => evaluationRefKey(ref) === key)}
                          onChange={(event) =>
                            patch({
                              attemptRefs: event.target.checked
                                ? [...value.attemptRefs, attempt.ref]
                                : value.attemptRefs.filter((ref) => evaluationRefKey(ref) !== key),
                            })
                          }
                        />
                        <span>
                          {attempt.label}
                          <small>
                            {attempt.status} · {attempt.usage ? 'usage reçu' : 'usage inconnu'}
                            {occupied.has(key) ? ' · déjà comptée' : ''}
                          </small>
                        </span>
                      </label>
                    );
                  })}
              </div>
              <p className="field-help">
                Les totaux des tentatives sont copiés une seule fois. Ne liez pas une même tentative
                à plusieurs phases ; un appel mixte reste non ventilé.
              </p>
            </>
          )}
        </fieldset>
        <fieldset>
          <legend>Contexte et comparabilité</legend>
          <div className="applications-form-grid">
            {Object.entries(configurationLabels).map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  value={value.configuration[key as keyof typeof configurationLabels]}
                  placeholder="Inconnu"
                  onChange={(event) =>
                    patch({ configuration: { ...value.configuration, [key]: event.target.value } })
                  }
                />
              </label>
            ))}
          </div>
          <p className="field-help">
            Utilisez les mêmes identifiants pour des contextes identiques. Pour A, indiquez
            explicitement « sans bibliothèque » si c’est le cas. Une information manquante ou
            incompatible exclut la paire du calcul du gain.
          </p>
        </fieldset>
        <label className="field">
          <span>Observations locales (exclues de l’export)</span>
          <textarea
            rows={3}
            value={value.observations ?? ''}
            onChange={(event) => patch({ observations: event.target.value })}
          />
        </label>
        <div className="applications-actions">
          <button type="button" onClick={close}>
            Annuler
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Enregistrer la mesure
          </button>
        </div>
      </form>
    </StudioDialog>
  );
}
