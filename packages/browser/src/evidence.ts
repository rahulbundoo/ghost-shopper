import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page, ConsoleMessage, Request, Response } from 'playwright';
import type { ActionResult, CapturedEvidence, ArtifactType } from '@ghostshopper/domain';
import { safeResultUrl } from './safety.js';

export type EvidenceSink = (evidence: CapturedEvidence) => Promise<void>;
const MAX_EVENTS = 200;
const MAX_BYTES = 20 * 1024 * 1024;
// Arbitrary console text/arguments and exception messages often contain secrets.
// Preserve event category, source and timings, not those untrusted strings.
export class EvidenceCollector {
  private readonly consoleEvents: object[] = [];
  private readonly networkEvents: object[] = [];
  private droppedConsole = 0;
  private droppedNetwork = 0;
  private readonly errors = new Set<string>();
  private readonly screenshots = new Set<number>();
  private readonly steps: ActionResult[] = [];
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private traceDirectory: string | undefined;
  private traceStopped: Promise<void> | undefined;
  private traceBody: Uint8Array | undefined;
  private bytes = 0;
  private position: number | null = null;
  private startedAt = Date.now();
  private finished = false;
  constructor(
    private readonly sink: EvidenceSink,
    private readonly traceEnabled = true,
  ) {}
  get incomplete() {
    return this.errors.size > 0;
  }
  begin(position: number) {
    this.position = position;
  }
  private push(kind: 'console' | 'network', event: object) {
    const list = kind === 'console' ? this.consoleEvents : this.networkEvents;
    if (list.length < MAX_EVENTS)
      list.push({ elapsedMs: Date.now() - this.startedAt, stepPosition: this.position, ...event });
    else if (kind === 'console') this.droppedConsole++;
    else this.droppedNetwork++;
  }
  private readonly onConsole = (message: ConsoleMessage) => {
    const location = message.location();
    this.push('console', {
      kind: message.type(),
      url: safeResultUrl(location.url),
      line: location.lineNumber,
      message: '[console text omitted for privacy]',
    });
  };
  private readonly onPageError = () =>
    this.push('console', { kind: 'pageerror', message: '[exception text omitted for privacy]' });
  private readonly onRequestFailed = (request: Request) =>
    this.push('network', {
      kind: 'REQUEST_FAILED',
      method: request.method(),
      url: safeResultUrl(request.url()),
      resourceType: request.resourceType(),
      errorCode: 'NETWORK_REQUEST_FAILED',
    });
  private readonly onResponse = (response: Response) => {
    if (response.status() >= 400)
      this.push('network', {
        kind: 'HTTP_ERROR',
        status: response.status(),
        method: response.request().method(),
        url: safeResultUrl(response.url()),
        resourceType: response.request().resourceType(),
      });
  };
  async start(context: BrowserContext, page: Page) {
    this.context = context;
    this.page = page;
    this.startedAt = Date.now();
    page.on('console', this.onConsole);
    page.on('pageerror', this.onPageError);
    context.on('requestfailed', this.onRequestFailed);
    context.on('response', this.onResponse);
    if (!this.traceEnabled) return;
    try {
      this.traceDirectory = await mkdtemp(join(tmpdir(), 'ghostshopper-evidence-'));
      // Operation timeline only; masked screenshots and redacted diagnostics supplement it.
      await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
    } catch {
      this.errors.add('TRACE_START_FAILED');
    }
  }
  async afterStep(step: ActionResult) {
    this.steps.push(step);
    if (step.status !== 'SKIPPED') await this.screenshot(step.position);
  }
  private async emit(type: ArtifactType, body: Uint8Array, stepPosition: number | null = null) {
    if (
      !body.byteLength ||
      body.byteLength > MAX_BYTES ||
      // Reserve 1 MiB for bounded JSON diagnostics even after large screenshots/traces.
      this.bytes + body.byteLength >
        (type === 'SCREENSHOT' || type === 'TRACE' ? 31 : 32) * 1024 * 1024
    ) {
      this.errors.add(`${type}_SIZE_LIMIT`);
      return;
    }
    this.bytes += body.byteLength;
    try {
      await this.sink({ type, body, stepPosition });
    } catch {
      this.errors.add(`${type}_UPLOAD_FAILED`);
    }
  }
  private async screenshot(position: number) {
    if (this.screenshots.has(position)) return;
    this.screenshots.add(position);
    if (!this.page || this.page.isClosed()) {
      this.errors.add('SCREENSHOT_PAGE_CLOSED');
      return;
    }
    try {
      const body = await this.page.screenshot({
        type: 'png',
        fullPage: false,
        scale: 'css',
        animations: 'disabled',
        caret: 'hide',
        timeout: 2000,
        mask: [this.page.locator('input, textarea, [contenteditable], iframe')],
      });
      await this.emit('SCREENSHOT', body, position);
    } catch {
      this.errors.add('SCREENSHOT_CAPTURE_FAILED');
    }
  }
  async interrupt() {
    if (this.position !== null) await this.screenshot(this.position);
    await this.stopTrace();
  }
  private stopTrace(): Promise<void> {
    if (!this.traceEnabled) return Promise.resolve();
    this.traceStopped ??= (async () => {
      if (!this.context || !this.traceDirectory) {
        this.errors.add('TRACE_UNAVAILABLE');
        return;
      }
      try {
        const path = join(this.traceDirectory, 'trace.zip');
        await this.context.tracing.stop({ path });
        const size = (await stat(path)).size;
        if (size > MAX_BYTES) this.errors.add('TRACE_SIZE_LIMIT');
        else this.traceBody = await readFile(path);
      } catch {
        this.errors.add('TRACE_CAPTURE_FAILED');
      }
    })();
    return this.traceStopped;
  }
  async finish() {
    if (this.finished) return;
    this.finished = true;
    try {
      await this.stopTrace();
      this.page?.off('console', this.onConsole);
      this.page?.off('pageerror', this.onPageError);
      this.context?.off('requestfailed', this.onRequestFailed);
      this.context?.off('response', this.onResponse);
      if (this.traceBody) await this.emit('TRACE', this.traceBody);
      const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
      await this.emit(
        'CONSOLE',
        json({ version: 1, events: this.consoleEvents, dropped: this.droppedConsole }),
      );
      await this.emit(
        'NETWORK',
        json({ version: 1, events: this.networkEvents, dropped: this.droppedNetwork }),
      );
      await this.emit(
        'METADATA',
        json({
          version: 1,
          startedAt: new Date(this.startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          steps: this.steps,
          captureErrors: [...this.errors],
          traceProfile: this.traceEnabled ? 'operations-only-sensitive' : 'disabled',
          diagnosticText: 'omitted',
          truncated: { console: this.droppedConsole, network: this.droppedNetwork },
        }),
      );
    } finally {
      // Only the unique directory returned by mkdtemp is removed, never a supplied path.
      if (this.traceDirectory) {
        try {
          await rm(this.traceDirectory, { recursive: true, force: true });
        } catch {
          this.errors.add('TEMP_CLEANUP_FAILED');
        }
      }
    }
  }
}
