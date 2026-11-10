import { useState } from 'react';
import {
  PR_CONTEXT_MAX_ITEMS,
  PR_CONTEXT_MAX_SELECTED,
  prSessionContextLabels,
  type PrSessionContextCatalog,
  type PrSessionContextSelection,
} from '../src/shared/prSessionContext';
export function PrSessionContextPicker({
  catalog,
  selected,
  busy,
  load,
  onChange,
}: {
  catalog?: PrSessionContextCatalog;
  selected: PrSessionContextSelection[];
  busy: boolean;
  load: () => void;
  onChange: (value: PrSessionContextSelection[]) => void;
}) {
  const [query, setQuery] = useState(''),
    [limit, setLimit] = useState(30),
    [kind, setKind] = useState('');
  const items = catalog?.items ?? [];
  const filtered = items.filter(
    (item) =>
      (!kind || item.kind === kind) &&
      `${item.label}\n${item.origin}\n${item.content}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const chosen = selected.flatMap((selection) => {
    const item = items.find((item) => item.id === selection.id);
    return item ? [item] : [];
  });
  const size = chosen.reduce((n, item) => n + item.content.length, 0);
  const stale =
    !!catalog &&
    selected.some(
      (selection) =>
        !items.some((item) => item.id === selection.id && item.digest === selection.digest),
    );
  function select(id: string, digest: string, checked: boolean) {
    onChange(
      checked
        ? [...selected.filter((item) => item.id !== id), { id, digest }]
        : selected.filter((item) => item.id !== id),
    );
  }
  return (
    <section aria-label="Contexte issu de la session" className="pr-session-context">
      <h3>Ajouter du contexte depuis la session</h3>
      <p>
        Un extrait du besoin et du dernier compte rendu (3 500 caractères chacun), ainsi qu’un
        résumé des preuves, sont inclus automatiquement. Choisis ici les échanges, autres comptes
        rendus, consignes et documents importés utiles à cette PR. Pour utiliser un rapport complet,
        sélectionne toutes ses parties. Les textes longs sont découpés en parties ; les originaux
        restent inchangés.
      </p>
      <button type="button" disabled={busy} onClick={load}>
        {catalog ? 'Actualiser les sources de la session' : 'Charger les sources de la session'}
      </button>
      <p>
        {selected.length} / {PR_CONTEXT_MAX_ITEMS} éléments sélectionnés
        {catalog
          ? ` · ${size.toLocaleString('fr-FR')} / ${PR_CONTEXT_MAX_SELECTED.toLocaleString('fr-FR')} caractères`
          : ''}
        . La sélection est conservée avec la mission.
      </p>
      {stale && (
        <p role="alert">
          Une source a changé ou n’est plus disponible. Retire-la ou relis sa nouvelle version avant
          de la sélectionner.
        </p>
      )}
      {size > PR_CONTEXT_MAX_SELECTED && (
        <p role="alert">
          Le contexte dépasse la limite. Retire des éléments avant de préparer les interventions.
        </p>
      )}
      {!!selected.length && (
        <button type="button" disabled={busy} onClick={() => onChange([])}>
          Vider la sélection de contexte
        </button>
      )}
      {catalog && (
        <>
          <p>
            Session : <strong>{catalog.title}</strong>
          </p>
          <details>
            <summary>Voir le résumé transmis automatiquement</summary>
            <pre className="devops-text">{catalog.summary}</pre>
          </details>
          {catalog.warnings.map((warning) => (
            <p key={warning} role="note">
              {warning}
            </p>
          ))}
          {!!selected.length && (
            <details open>
              <summary>Voir le contexte sélectionné ({selected.length})</summary>
              {selected.map((selection) => {
                const item = items.find((item) => item.id === selection.id);
                return (
                  <article key={selection.id} className="devops-card">
                    <strong>{item?.label ?? 'Source devenue indisponible'}</strong>
                    {item && (
                      <>
                        <p>{item.origin}</p>
                        {item.digest !== selection.digest && (
                          <p>Cette version a changé depuis ta sélection.</p>
                        )}
                        <details>
                          <summary>Lire ce texte</summary>
                          <pre className="devops-text">{item.content}</pre>
                        </details>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => select(selection.id, selection.digest, false)}
                    >
                      Retirer cette source
                    </button>
                  </article>
                );
              })}
            </details>
          )}
          <label>
            Rechercher dans le contexte de session
            <input
              value={query}
              disabled={busy}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(30);
              }}
            />
          </label>
          <label>
            Type de source
            <select
              value={kind}
              disabled={busy}
              onChange={(e) => {
                setKind(e.target.value);
                setLimit(30);
              }}
            >
              <option value="">Tous les textes</option>
              {Object.entries(prSessionContextLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {filtered.length} source(s) disponible(s)
            {filtered.length > limit ? ` · ${limit} affichées` : ''}.
          </p>
          <div className="pr-session-sources">
            {filtered.slice(0, limit).map((item) => {
              const selection = selected.find((selection) => selection.id === item.id),
                valid = selection?.digest === item.digest;
              return (
                <article className="devops-card" key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={valid}
                      disabled={
                        busy ||
                        (!valid &&
                          ((!selection && selected.length >= PR_CONTEXT_MAX_ITEMS) ||
                            size + (selection ? 0 : item.content.length) > PR_CONTEXT_MAX_SELECTED))
                      }
                      onChange={(e) => select(item.id, item.digest, e.target.checked)}
                    />
                    {item.label}
                  </label>
                  <p>
                    {prSessionContextLabels[item.kind]} · {item.origin} ·{' '}
                    {item.content.length.toLocaleString('fr-FR')} caractères
                  </p>
                  {selection && !valid && (
                    <p>
                      Version modifiée : relis le texte puis recoche cette source pour l’utiliser.
                    </p>
                  )}
                  <details>
                    <summary>Lire le texte à transmettre</summary>
                    <pre className="devops-text">{item.content}</pre>
                  </details>
                </article>
              );
            })}
          </div>
          {filtered.length > limit && (
            <button type="button" disabled={busy} onClick={() => setLimit(limit + 30)}>
              Afficher 30 sources de plus
            </button>
          )}
        </>
      )}
    </section>
  );
}
