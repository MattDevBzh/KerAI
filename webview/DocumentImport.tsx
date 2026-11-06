import { useRef, useState } from 'react';
import type { ImportedDocument } from './documentSource';

export function DocumentImport({
  value,
  onChange,
  maxLength = 500000,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ document: ImportedDocument; context: string }>();
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  return (
    <div className="document-import">
      <button
        type="button"
        className="button secondary"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Extraction du document…' : 'Importer un document'}
      </button>
      <input
        ref={input}
        aria-label="Document source à importer"
        type="file"
        hidden
        accept=".txt,.md,.markdown,.pdf,.docx,.html,.htm"
        disabled={disabled || busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError('');
          setDraft(undefined);
          try {
            const { importDocumentSource, documentSourceContext } = await import(
              './documentSource'
            );
            const document = await importDocumentSource(file);
            setDraft({ document, context: documentSourceContext(document) });
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Extraction impossible.');
          } finally {
            setBusy(false);
          }
        }}
      />
      <small className="field-help">
        TXT, Markdown, PDF texte, Word .docx, HTML · 20 Mio maximum. Extraction locale sans appel IA
        ; le texte ajouté sera transmis au lancement de l’agent.
      </small>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <section aria-label="Document extrait">
          <strong>{draft.document.name}</strong>
          <p>{draft.document.text.length.toLocaleString('fr-FR')} caractères extraits.</p>
          {draft.document.warnings.map((warning) => (
            <p className="field-help" key={warning}>
              {warning}
            </p>
          ))}
          <details>
            <summary>Vérifier le texte extrait</summary>
            <textarea
              aria-label="Texte extrait du document"
              readOnly
              value={draft.document.text}
              rows={8}
            />
          </details>
          {value.length + draft.context.length > maxLength && (
            <p role="alert">
              Le contexte dépasserait {maxLength.toLocaleString('fr-FR')} caractères. Réduis le
              texte actuel ou importe un extrait plus court.
            </p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={disabled || value.length + draft.context.length > maxLength}
            onClick={() => {
              if (latest.current.length + draft.context.length > maxLength) {
                setError('Le contexte a changé et dépasse la limite.');
                return;
              }
              onChange(latest.current + draft.context);
              setDraft(undefined);
            }}
          >
            Ajouter le texte au contexte
          </button>
          <button type="button" className="button text" onClick={() => setDraft(undefined)}>
            Annuler l’import
          </button>
        </section>
      )}
    </div>
  );
}
