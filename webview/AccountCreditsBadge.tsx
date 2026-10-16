import { useEffect, useRef } from 'react';
import { ChevronDown, Zap } from 'lucide-react';
import { formatCredits, type AccountCredits } from '../src/shared/credits';

export function AccountCreditsBadge({ credits }: { credits?: AccountCredits }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node))
        details.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.current?.open) return;
      event.preventDefault();
      details.current.open = false;
      details.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const ready = credits?.state === 'ready';
  const value = ready
    ? `${formatCredits(credits.used!)} / ${credits.unlimited ? 'illimité' : formatCredits(credits.included!)}`
    : credits
      ? 'Indisponibles'
      : 'Chargement…';
  return (
    <details className="account-credits" ref={details}>
      <summary aria-label={`Crédits du compte GitHub Copilot : ${value}`}>
        <Zap size={15} aria-hidden="true" />
        <span>Copilot</span>
        <strong aria-live="polite">{value}</strong>
        {ready && <span className="account-credits-unit">crédits</span>}
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <section className="account-credits-details" aria-label="Détail des crédits Copilot">
        <strong>Crédits du compte GitHub Copilot</strong>
        {ready ? (
          <>
            <p className="account-credits-total">{value} crédits</p>
            <p>Consommés / inclus · tous les usages du compte.</p>
            {credits.overage !== undefined && credits.overage > 0 && (
              <p>{formatCredits(credits.overage)} crédits supplémentaires consommés.</p>
            )}
            {credits.overageAllowed !== undefined && (
              <p>Dépassement {credits.overageAllowed ? 'autorisé' : 'non autorisé'} par Copilot.</p>
            )}
            {credits.resetDate && (
              <p>Renouvellement : {new Date(credits.resetDate).toLocaleDateString('fr-FR')}.</p>
            )}
            {credits.checkedAt && (
              <p>Actualisé à {new Date(credits.checkedAt).toLocaleTimeString('fr-FR')}.</p>
            )}
          </>
        ) : (
          <p>{credits?.message ?? 'Chargement du quota du compte…'}</p>
        )}
        <small>
          Actualisation toutes les 10 secondes lorsque le cockpit est visible. Le relevé GitHub peut
          être différé. Les totaux des sessions sont disponibles dans Consommation.
        </small>
      </section>
    </details>
  );
}
