import type { Usage } from './types';

// Copilot SDK totalNanoAiu: 1 AI credit = 1e9 nano-AIU.
// https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing
export const NANO_AIU_PER_CREDIT = 1_000_000_000;
export const toCredits = (nanoAiu: number): number => nanoAiu / NANO_AIU_PER_CREDIT;
export const toNanoAiu = (credits: number): number => Math.round(credits * NANO_AIU_PER_CREDIT);
export const formatCredits = (credits: number): string =>
  credits > 0 && credits < 0.000001
    ? '< 0,000001'
    : credits.toLocaleString('fr-FR', { maximumFractionDigits: 6 });

export function usageCredits(usage: Usage): string {
  const known =
    usage.source === 'measured' &&
    usage.unit === 'nano-AIU' &&
    typeof usage.cost === 'number' &&
    Number.isFinite(usage.cost) &&
    usage.cost >= 0;
  return known
    ? `${formatCredits(toCredits(usage.cost!))} crédits${usage.incompleteCost ? ' · mesure partielle' : ''}`
    : 'Crédits non communiqués';
}

export interface AccountCredits {
  state: 'ready' | 'unavailable';
  message?: string;
  used?: number;
  included?: number;
  unlimited?: boolean;
  overage?: number;
  overageAllowed?: boolean;
  resetDate?: string;
  checkedAt?: string;
}

interface Quota {
  entitlementRequests: number;
  usedRequests: number;
  isUnlimitedEntitlement: boolean;
  overage: number;
  overageAllowedWithExhaustedQuota: boolean;
  resetDate?: string;
}

/** Never relabel legacy premium requests as credits or infer a plan allowance. */
export function accountCredits(
  snapshots: Record<string, Quota | undefined>,
  user?: {
    token_based_billing?: boolean;
    quota_snapshots?: Record<string, { token_based_billing?: boolean } | null | undefined>;
  },
): AccountCredits {
  const key = ['premium_interactions', 'premium_models', 'chat'].find(
    (key) =>
      snapshots[key] &&
      (user?.quota_snapshots?.[key]?.token_based_billing ?? user?.token_based_billing) === true,
  );
  const quota = key && snapshots[key];
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (
    !quota ||
    !finite(quota.usedRequests) ||
    (!quota.isUnlimitedEntitlement && !finite(quota.entitlementRequests))
  )
    return {
      state: 'unavailable',
      message: 'Le CLI ne communique pas de quota en crédits pour ce compte.',
    };
  return {
    state: 'ready',
    used: quota.usedRequests,
    included: quota.isUnlimitedEntitlement ? undefined : quota.entitlementRequests,
    unlimited: quota.isUnlimitedEntitlement,
    overage: finite(quota.overage) ? quota.overage : undefined,
    overageAllowed: quota.overageAllowedWithExhaustedQuota,
    resetDate:
      quota.resetDate && Number.isFinite(Date.parse(quota.resetDate)) ? quota.resetDate : undefined,
    checkedAt: new Date().toISOString(),
  };
}
