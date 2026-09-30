export const JOURNEY_ACTIONS = [
  'OPEN_HOME',
  'FIND_PRODUCT',
  'OPEN_PRODUCT',
  'SELECT_VARIANT',
  'ADD_TO_CART',
  'OPEN_CART',
  'BEGIN_CHECKOUT',
] as const;
export type JourneyActionName = (typeof JOURNEY_ACTIONS)[number];
export const STEP_STATUSES = ['PASSED', 'FAILED', 'SKIPPED'] as const;
export const STEP_ERROR_CODES = [
  'PAGE_UNAVAILABLE',
  'PRODUCT_NOT_FOUND',
  'VARIANT_UNAVAILABLE',
  'VARIANT_SELECTOR_FAILURE',
  'ADD_TO_CART_FAILURE',
  'CART_FAILURE',
  'CHECKOUT_FAILURE',
  'ACTION_TIMEOUT',
  'UNSAFE_NAVIGATION',
  'RUN_ABORTED',
  'PREVIOUS_STEP_FAILED',
] as const;
export type StepErrorCode = (typeof STEP_ERROR_CODES)[number];
export interface ActionResult {
  readonly action: JourneyActionName;
  readonly position: number;
  readonly status: (typeof STEP_STATUSES)[number];
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;
  /** Sanitized origin + path only. Never query strings, checkout tokens or credentials. */
  readonly currentUrl: string | null;
  readonly errorCode: StepErrorCode | null;
  readonly errorMessage: string | null;
}
export interface RunStep extends ActionResult {
  readonly id: string;
  readonly shopId: string;
  readonly runId: string;
  readonly attempt: number;
}
