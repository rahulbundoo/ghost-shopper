import type { RunClaim } from '../../packages/application/src/index.js';
import type {
  ActionResult,
  AiCompletion,
  JourneyAnalysis,
  JourneyAnalysisInput,
} from '../../packages/domain/src/index.js';
export const aiClaim: RunClaim = {
  run: {
    id: '57e735d9-220b-4be1-8fda-fda1c7a71ab5',
    shopId: 'test.myshopify.com',
    monitorId: '0246091e-d6bc-42b8-a31a-ea073bb7b360',
    monitorVersion: 1,
    scenario: 'PURCHASE_JOURNEY',
    device: 'MOBILE',
    productId: 'gid://shopify/Product/1',
    variantId: null,
    status: 'COMPLETED',
    outcome: 'PASSED',
    createdAt: new Date(0),
    startedAt: new Date(0),
    finishedAt: new Date(1),
    attemptCount: 1,
    errorCode: null,
  },
  token: 'ed0dcc62-60ac-4a2e-a49f-44950e3bb033',
  attempt: 1,
};
// One-pixel PNG fixture. Production bytes come only from masked Playwright captures.
export const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=';
export const aiStep: ActionResult = {
  action: 'OPEN_PRODUCT',
  position: 2,
  status: 'PASSED',
  durationMs: 1,
  errorCode: null,
  errorMessage: 'secret text',
  currentUrl: 'https://store.test/private-token',
  startedAt: new Date(0),
  finishedAt: new Date(1),
};
export const aiInput: JourneyAnalysisInput = {
  device: 'MOBILE',
  steps: [
    { action: 'OPEN_PRODUCT', position: 2, status: 'PASSED', durationMs: 1, errorCode: null },
  ],
  technicalFindings: [],
  screenshots: [{ stepPosition: 2, pngBase64 }],
};
export const aiResult: JourneyAnalysis = {
  experience: 'WARNING',
  experienceScore: 72,
  findings: [
    {
      type: 'UNCLEAR_SHIPPING',
      severity: 'MEDIUM',
      step: 2,
      title: 'Shipping terms may be unclear',
      description: 'Visible shipping labels conflict.',
      evidence: 'Two shipping labels appear with different terms.',
      confidence: 0.8,
    },
  ],
};
export const aiCompletion: AiCompletion = {
  status: 'SUCCEEDED',
  responseAt: new Date(1),
  latencyMs: 1,
  usage: { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100 },
  estimatedCostUsd: '0.00190000',
  result: aiResult,
  errorCode: null,
};
