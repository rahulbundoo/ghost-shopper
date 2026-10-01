export const SCENARIOS = ['PURCHASE_JOURNEY'] as const;
export * from './run-lifecycle.js';
export * from './journey.js';
export * from './artifacts.js';
export * from './findings.js';
export * from './incidents.js';
export const DEVICE_PROFILES = ['DESKTOP', 'MOBILE'] as const;
export const MONITOR_FREQUENCIES = ['HOURLY', 'EVERY_SIX_HOURS', 'DAILY'] as const;
export const RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COLLECTING',
  'ANALYZING',
  'COMPLETED',
  'ERROR',
  'CANCELLED',
] as const;
export const RUN_OUTCOMES = ['PASSED', 'WARNING', 'FAILED', 'ERROR', 'CANCELLED'] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type DeviceProfile = (typeof DEVICE_PROFILES)[number];
export type MonitorFrequency = (typeof MONITOR_FREQUENCIES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export interface Shop {
  readonly id: string;
  readonly shopifyId: string | null;
  readonly name: string | null;
  readonly storefrontUrl: string | null;
  readonly currencyCode: string | null;
  readonly installedAt: Date | null;
  readonly uninstalledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface JourneyConfiguration {
  readonly scenario: Scenario;
  readonly device: DeviceProfile;
  readonly productId: string;
  readonly variantId: string | null;
}
export interface Monitor extends JourneyConfiguration {
  readonly id: string;
  readonly shopId: string;
  readonly name: string;
  readonly frequency: MonitorFrequency;
  readonly enabled: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface TestRun extends JourneyConfiguration {
  readonly id: string;
  readonly shopId: string;
  readonly monitorId: string;
  readonly monitorVersion: number;
  readonly status: RunStatus;
  readonly outcome: RunOutcome | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly attemptCount: number;
  readonly errorCode: string | null;
}
export type DomainErrorCode =
  | 'SHOP_INACTIVE'
  | 'MONITOR_DISABLED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BILLING_REQUIRED'
  | 'RUN_LIMIT_REACHED';
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode) {
    super(code);
    this.name = 'DomainError';
  }
}
export function assertShopActive(shop: Shop | null): asserts shop is Shop {
  if (!shop?.installedAt || shop.uninstalledAt) throw new DomainError('SHOP_INACTIVE');
}
// Snapshot execution inputs so later monitor edits cannot rewrite a run's history.
export function snapshotMonitor(
  monitor: Monitor,
): JourneyConfiguration & { monitorVersion: number } {
  if (!monitor.enabled) throw new DomainError('MONITOR_DISABLED');
  return {
    scenario: monitor.scenario,
    device: monitor.device,
    productId: monitor.productId,
    variantId: monitor.variantId,
    monitorVersion: monitor.version,
  };
}
export * from './ai.js';
export * from './automation.js';
export * from './billing.js';
