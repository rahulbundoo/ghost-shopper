import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router';
import type { Monitor, TestRun } from '@ghostshopper/domain';
import { MonitorEditor } from '../app/components/monitor-editor';
import { NotificationSettingsView } from '../app/components/notification-settings';
import { BillingView } from '../app/components/billing';
import { Overview } from '../app/components/overview';
import { RunDetails, type RunDetailsData } from '../app/components/run-details';
import '../app/styles.css';

const date = new Date('2026-09-30T12:00:00Z');
const monitor: Monitor = {
  id: '0246091e-d6bc-42b8-a31a-ea073bb7b360',
  shopId: 'fixture.myshopify.com',
  name: 'Featured product · mobile',
  scenario: 'PURCHASE_JOURNEY',
  device: 'MOBILE',
  productId: 'gid://shopify/Product/123',
  variantId: null,
  frequency: 'DAILY',
  enabled: true,
  version: 1,
  createdAt: date,
  updatedAt: date,
};
const run: TestRun = {
  ...monitor,
  id: '57e735d9-220b-4be1-8fda-fda1c7a71ab5',
  monitorId: monitor.id,
  monitorVersion: 1,
  status: 'COMPLETED',
  outcome: 'FAILED',
  attemptCount: 2,
  startedAt: date,
  finishedAt: date,
  errorCode: null,
};
const runData: RunDetailsData = {
  run,
  steps: [
    {
      id: 'step',
      shopId: monitor.shopId,
      runId: run.id,
      attempt: 2,
      action: 'ADD_TO_CART',
      position: 4,
      status: 'FAILED',
      startedAt: date,
      finishedAt: date,
      durationMs: 8200,
      currentUrl: 'https://fixture.example/products/example',
      errorCode: 'ADD_TO_CART_FAILURE',
      errorMessage: 'Adding the selected item could not be verified.',
    },
  ],
  artifacts: [
    {
      id: 'evidence',
      shopId: monitor.shopId,
      runId: run.id,
      attempt: 2,
      stepId: 'step',
      stepPosition: 4,
      type: 'SCREENSHOT',
      mimeType: 'image/png',
      sizeBytes: 1024,
      sha256: 'fixture',
      status: 'READY',
      errorCode: null,
      createdAt: date,
      expiresAt: new Date('2099-01-01'),
    },
  ],
  analyses: [
    {
      shopId: monitor.shopId,
      runId: run.id,
      attempt: 2,
      rulesVersion: 'technical-v1',
      score: 0,
      complete: true,
      outcome: 'FAILED',
      createdAt: date,
      findings: [
        {
          id: 'finding',
          shopId: monitor.shopId,
          runId: run.id,
          attempt: 2,
          source: 'DETECTED',
          fingerprint: 'fixture',
          stepId: 'step',
          evidenceArtifactId: 'evidence',
          createdAt: date,
          type: 'ADD_TO_CART_FAILURE',
          severity: 'CRITICAL',
          title: 'Add to cart failed',
          description: 'Adding the selected item to the cart could not be verified.',
          stepPosition: 4,
          occurrences: 1,
          evidenceType: 'SCREENSHOT',
        },
      ],
    },
  ],
  aiAnalyses: [],
};
const router = createBrowserRouter([
  {
    element: (
      <div className="gs-app">
        <nav className="gs-nav">
          <strong>Synthetic UI fixture — no live store</strong>
          <Link to="/app">Overview</Link>
          <Link to="/app/monitors/new">New monitor</Link>
          <Link to={`/app/monitors/${monitor.id}`}>Edit monitor</Link>
          <Link to={`/app/runs/${run.id}`}>Run details</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/billing">Billing</Link>
        </nav>
        <div id="merchant-content">
          <Outlet />
        </div>
      </div>
    ),
    children: [
      {
        path: '/app/billing',
        element: (
          <BillingView
            enabled
            summary={{
              status: 'TRIAL',
              trialEndsAt: date,
              periodEnd: null,
              verifiedAt: date,
              used: 100,
              limit: 100,
              eligible: false,
              canCancel: false,
              policy: {
                priceUsd: '19.00',
                paidRunLimit: 1000,
                trialDays: 14,
                trialRunLimit: 100,
                test: true,
              },
            }}
          />
        ),
      },
      {
        path: '/app/billing-active',
        element: (
          <BillingView
            enabled
            summary={{
              status: 'ACTIVE',
              trialEndsAt: date,
              periodEnd: date,
              verifiedAt: date,
              used: 12,
              limit: 1000,
              eligible: true,
              canCancel: true,
              policy: {
                priceUsd: '19.00',
                paidRunLimit: 1000,
                trialDays: 14,
                trialRunLimit: 100,
                test: true,
              },
            }}
          />
        ),
      },
      {
        path: '/app/settings',
        element: (
          <NotificationSettingsView
            settings={null}
            history={[]}
            emailConfigured={false}
            schedulerEnabled={false}
          />
        ),
      },
      {
        path: '/app',
        element: (
          <Overview
            data={{
              name: 'Fixture store',
              domain: monitor.shopId,
              hasMonitors: true,
              runs: [run],
              incidents: [],
              analysis: runData.analyses[0] ?? null,
            }}
          />
        ),
      },
      { path: '/app/monitors/new', element: <MonitorEditor monitor={null} /> },
      { path: '/app/monitors/:monitorId', element: <MonitorEditor monitor={monitor} /> },
      { path: '/app/runs/:runId', element: <RunDetails data={runData} /> },
    ],
  },
]);
const root = document.getElementById('root');
if (root) createRoot(root).render(<RouterProvider router={router} />);
