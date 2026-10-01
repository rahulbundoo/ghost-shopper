export interface BillingPolicy {
  readonly priceUsd: string;
  readonly paidRunLimit: number;
  readonly trialDays: number;
  readonly trialRunLimit: number;
  readonly test: boolean;
}
export interface SubscriptionSnapshot {
  readonly providerId: string;
  readonly periodEnd: Date;
}
export interface BillingState {
  readonly status: string;
  readonly trialEndsAt: Date;
  readonly everPaid: boolean;
  readonly periodEnd: Date | null;
  readonly verifiedAt: Date | null;
  readonly policyKey: string | null;
}
export function billingPolicyKey(policy: BillingPolicy) {
  return `${policy.test ? 'test' : 'live'}:${policy.priceUsd}:${policy.paidRunLimit}`;
}
export const BILLING_FRESHNESS_MS = 60 * 60 * 1000;
export function runAllowance(state: BillingState, policy: BillingPolicy, now: Date) {
  if (
    state.status === 'ACTIVE' &&
    state.policyKey === billingPolicyKey(policy) &&
    state.periodEnd &&
    state.periodEnd > now &&
    state.verifiedAt &&
    now.getTime() - state.verifiedAt.getTime() < BILLING_FRESHNESS_MS
  ) {
    return {
      key: `paid:${state.periodEnd.toISOString()}`,
      limit: policy.paidRunLimit,
      endsAt: state.periodEnd,
    };
  }
  if (!state.everPaid && state.trialEndsAt > now) {
    return { key: 'trial', limit: policy.trialRunLimit, endsAt: state.trialEndsAt };
  }
  return null;
}
