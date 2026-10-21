import type { PairPreferences } from '../src/shared/pair';
export function PairPreferencesUI({
  value,
  onChange,
  disabled = false,
}: {
  value: PairPreferences;
  onChange: (value: PairPreferences) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="pair-preferences" disabled={disabled}>
      <legend>Notre façon de travailler</legend>
      <label className="field">
        <span>Rythme</span>
        <select
          value={value.pace}
          onChange={(e) => onChange({ ...value, pace: e.target.value as PairPreferences['pace'] })}
        >
          <option value="small">Pas à pas · petits blocs</option>
          <option value="blocks">Par blocs · points de contrôle</option>
          <option value="oneshot">En une fois · après le cadrage</option>
        </select>
      </label>
      <label className="field">
        <span>Explications</span>
        <select
          value={value.explanation}
          onChange={(e) =>
            onChange({ ...value, explanation: e.target.value as PairPreferences['explanation'] })
          }
        >
          <option value="detailed">Détaillées · comprendre les choix</option>
          <option value="concise">Concises · aller à l’essentiel</option>
        </select>
      </label>
      <label className="field">
        <span>Mes préférences</span>
        <textarea
          rows={3}
          maxLength={10000}
          value={value.instructions}
          placeholder="Par exemple : discutons des choix techniques avant de modifier les fichiers."
          onChange={(e) => onChange({ ...value, instructions: e.target.value })}
        />
      </label>
    </fieldset>
  );
}
