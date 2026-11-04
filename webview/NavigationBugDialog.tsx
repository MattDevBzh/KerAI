import { useState } from 'react';
import type { NavigationCommand, NavigationJourney } from '../src/shared/navigation';
import { StudioDialog } from './ExecutionUI';

export function NavigationBugDialog({
  applicationId,
  journey,
  parameters,
  currentScreen,
  error,
  busy,
  onClose,
  onCreate,
}: {
  applicationId: string;
  journey?: NavigationJourney;
  parameters: Record<string, string>;
  currentScreen: boolean;
  error?: string;
  busy: boolean;
  onClose(): void;
  onCreate(command: NavigationCommand): void;
}) {
  const [title, setTitle] = useState(
    journey ? `Correction — ${journey.title}` : 'Correction de cet écran',
  );
  const [observed, setObserved] = useState('');
  const [expected, setExpected] = useState('');
  return (
    <StudioDialog title="Préparer une correction" onClose={onClose}>
      <p>
        {journey
          ? `${journey.title} · r${journey.revision} · paramètres conservés`
          : 'Écran courant : une capture sera jointe et l’accès restera à documenter.'}
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            action: 'createBug',
            applicationId,
            journeyId: journey?.id,
            parameters,
            title,
            observed,
            expected,
            currentScreen,
          });
        }}
      >
        <label className="field">
          <span>Titre de la correction</span>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Comportement observé</span>
          <textarea
            autoFocus
            required
            maxLength={4000}
            value={observed}
            onChange={(e) => setObserved(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Résultat attendu</span>
          <textarea
            required
            maxLength={4000}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </label>
        <p>
          Le plan, le développement et les tests retrouveront ce contexte. Le lancement de chaque
          agent conserve sa préparation et ses droits propres.
        </p>
        <button
          type="submit"
          className="primary"
          disabled={busy || !title.trim() || !observed.trim() || !expected.trim()}
        >
          Créer la session de correction
        </button>
      </form>
    </StudioDialog>
  );
}
