import { diagnosticExportSchema, captureManifestSchema } from '@ghostshopper/contracts';
import type { CapturedEvidence, TechnicalDiagnostic } from '@ghostshopper/domain';

/** Consume bounded exports before upload; never read blobs back or parse trace ZIPs. */
export class AnalysisDiagnostics {
  readonly events: TechnicalDiagnostic[] = [];
  private readonly seen = new Set<string>();
  private valid = true;
  markIncomplete() {
    this.valid = false;
  }
  get complete() {
    return this.valid && this.seen.has('CONSOLE') && this.seen.has('NETWORK');
  }
  capture(evidence: CapturedEvidence) {
    if (evidence.type === 'METADATA') {
      try {
        if (evidence.body.byteLength > 1024 * 1024) {
          this.valid = false;
          return;
        }
        const raw: unknown = JSON.parse(new TextDecoder().decode(evidence.body));
        if (captureManifestSchema.parse(raw).captureErrors.length) this.valid = false;
      } catch {
        this.valid = false;
      }
      return;
    }
    if (evidence.type !== 'CONSOLE' && evidence.type !== 'NETWORK') return;
    if (this.seen.has(evidence.type)) {
      this.valid = false;
      return;
    }
    this.seen.add(evidence.type);
    if (evidence.body.byteLength > 1024 * 1024) {
      this.valid = false;
      return;
    }
    try {
      const raw: unknown = JSON.parse(new TextDecoder().decode(evidence.body));
      const data = diagnosticExportSchema.parse(raw);
      if (data.dropped) this.valid = false;
      for (const event of data.events) {
        // Console.error is not proof of a JS exception; blocked requests are not HTTP responses.
        if (evidence.type === 'CONSOLE' && event.kind === 'pageerror')
          this.events.push({
            kind: 'JS_ERROR',
            stepPosition: event.stepPosition,
            resourceType: null,
          });
        if (
          evidence.type === 'NETWORK' &&
          event.kind === 'HTTP_ERROR' &&
          event.status &&
          event.status >= 400
        )
          this.events.push({
            kind: 'HTTP_ERROR',
            stepPosition: event.stepPosition,
            resourceType: event.resourceType ?? null,
          });
      }
    } catch {
      this.valid = false;
    }
  }
}
