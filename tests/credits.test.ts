import { describe, expect, it } from 'vitest';
import {
  accountCredits,
  formatCredits,
  toCredits,
  toNanoAiu,
  usageCredits,
} from '../src/shared/credits';

const quota = {
  entitlementRequests: 1500,
  usedRequests: 12.345,
  isUnlimitedEntitlement: false,
  overage: 0,
  overageAllowedWithExhaustedQuota: false,
  resetDate: '2026-11-01',
};
describe('Copilot credit accounting', () => {
  it('converts stored nano units and fractional budget inputs without changing storage', () => {
    expect(toCredits(1_500_000_000)).toBe(1.5);
    expect(toNanoAiu(1.5)).toBe(1_500_000_000);
    expect(toNanoAiu(toCredits(123456789))).toBe(123456789);
    expect(formatCredits(toCredits(400))).toBe('< 0,000001');
    expect(usageCredits({ source: 'measured', cost: 0, unit: 'nano-AIU' })).toBe('0 crédits');
    expect(usageCredits({ source: 'measured', cost: 1, unit: 'USD' })).toBe(
      'Crédits non communiqués',
    );
    expect(
      usageCredits({ source: 'measured', cost: 1e9, unit: 'nano-AIU', incompleteCost: true }),
    ).toContain('1 crédits · mesure partielle');
  });
  it('uses account credit units directly and never invents a plan limit', () => {
    expect(
      accountCredits({ premium_interactions: quota }, { token_based_billing: true }),
    ).toMatchObject({ state: 'ready', used: 12.345, included: 1500 });
    expect(accountCredits({ premium_interactions: quota })).toMatchObject({ state: 'unavailable' });
    expect(
      accountCredits({ premium_interactions: quota }, { token_based_billing: false }),
    ).toMatchObject({ state: 'unavailable' });
    expect(accountCredits({}, { token_based_billing: true })).toMatchObject({
      state: 'unavailable',
    });
  });
  it('handles zero, unlimited, overage, per-bucket billing, and malformed snapshots', () => {
    const user = { quota_snapshots: { premium_interactions: { token_based_billing: true } } };
    expect(accountCredits({ premium_interactions: { ...quota, usedRequests: 0 } }, user).used).toBe(
      0,
    );
    expect(
      accountCredits(
        {
          premium_interactions: {
            ...quota,
            isUnlimitedEntitlement: true,
            entitlementRequests: -1,
            overage: 2.5,
          },
        },
        user,
      ),
    ).toMatchObject({ unlimited: true, included: undefined, overage: 2.5 });
    expect(
      accountCredits({ premium_interactions: { ...quota, usedRequests: NaN } }, user).state,
    ).toBe('unavailable');
    expect(
      accountCredits({ premium_interactions: { ...quota, entitlementRequests: -1 } }, user).state,
    ).toBe('unavailable');
    expect(
      accountCredits(
        { premium_interactions: quota },
        {
          token_based_billing: true,
          quota_snapshots: { premium_interactions: { token_based_billing: false } },
        },
      ).state,
    ).toBe('unavailable');
  });
});
