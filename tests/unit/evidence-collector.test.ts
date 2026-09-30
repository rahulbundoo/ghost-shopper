import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceCollector } from '../../packages/browser/src/evidence.js';
import type { CapturedEvidence } from '../../packages/domain/src/index.js';

describe('bounded evidence diagnostics', () => {
  it('caps events, omits secrets, detaches listeners and finalizes only once', async () => {
    const artifacts: CapturedEvidence[] = [];
    const collector = new EvidenceCollector((evidence) => {
      artifacts.push(evidence);
      return Promise.resolve();
    });
    const page = new EventEmitter();
    const context = Object.assign(new EventEmitter(), {
      tracing: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockRejectedValue(new Error('private provider error')),
      },
    });
    await collector.start(context as unknown as BrowserContext, page as unknown as Page);
    collector.begin(2);
    const request = {
      method: () => 'GET',
      url: () => 'https://shop.example/product?secret=hidden',
      resourceType: () => 'fetch',
    };
    for (let i = 0; i < 205; i++) {
      page.emit('console', {
        type: () => 'error',
        text: () => 'secret console text',
        location: () => ({ url: request.url(), lineNumber: 8 }),
      });
      context.emit('requestfailed', request);
    }
    await collector.finish();
    await collector.finish();
    expect(artifacts.map((artifact) => artifact.type)).toEqual(['CONSOLE', 'NETWORK', 'METADATA']);
    for (const artifact of artifacts.slice(0, 2)) {
      const raw = new TextDecoder().decode(artifact.body);
      const data = JSON.parse(raw) as { events: { stepPosition: number }[]; dropped: number };
      expect(data.events).toHaveLength(200);
      expect(data.events[0]?.stepPosition).toBe(2);
      expect(data.dropped).toBe(5);
      expect(raw).not.toContain('secret');
    }
    expect(new TextDecoder().decode(artifacts[2]?.body)).toContain('TRACE_CAPTURE_FAILED');
    expect(collector.incomplete).toBe(true);
    expect(page.listenerCount('console')).toBe(0);
    expect(context.listenerCount('requestfailed')).toBe(0);
    expect(context.tracing.stop).toHaveBeenCalledTimes(1);
  });
});
