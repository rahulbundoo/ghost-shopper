import type { MonitorFrequency, Severity } from './index.js';

export const FREQUENCY_MS: Readonly<Record<MonitorFrequency, number>> = {
  HOURLY: 3_600_000,
  EVERY_SIX_HOURS: 21_600_000,
  DAILY: 86_400_000,
};
export function nextScheduledTime(now: Date, frequency: MonitorFrequency): Date {
  // Skip missed intervals after downtime; never replay a catch-up burst.
  return new Date(now.getTime() + FREQUENCY_MS[frequency]);
}
export function significantIncident(severity: Severity): boolean {
  return severity === 'HIGH' || severity === 'CRITICAL';
}
export type EmailKind = 'FAILURE' | 'RECOVERY';
export interface NotificationSettings {
  readonly email: string;
  readonly enabled: boolean;
  readonly recoveryEnabled: boolean;
  readonly version: number;
}
export const EMAIL_COOLDOWN_MS = 15 * 60_000;
export const EMAIL_RETRY_WINDOW_MS = 23 * 3_600_000;
export const EMAIL_MAX_ATTEMPTS = 6;
export interface EmailHistory {
  readonly id: string;
  readonly runId: string;
  readonly kind: EmailKind;
  readonly status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}
