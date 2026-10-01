import type { EmailClaim, EmailSender } from '@ghostshopper/application';

/** Fixed provider endpoint. Recipients, keys and response bodies never enter logs. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly config: { apiKey: string; from: string; appUrl: string },
    private readonly request: typeof fetch = fetch,
  ) {}
  async send(claim: EmailClaim): Promise<'ACCEPTED' | 'RETRY' | 'REJECTED'> {
    const recovery = claim.kind === 'RECOVERY';
    const subject = recovery
      ? 'GhostShopper: purchase journey recovered'
      : 'GhostShopper: purchase journey needs attention';
    const text = [
      subject,
      '',
      `Store: ${claim.shopId}`,
      recovery
        ? 'A later complete check resolved significant detected incidents for this journey configuration.'
        : 'One or more high or critical detected incidents opened or reappeared. Review the run for details.',
      '',
      `View run: ${this.config.appUrl}/app/runs/${claim.runId}?shop=${encodeURIComponent(claim.shopId)}`,
      '',
      'Checks stop at checkout initiation. No payment was submitted.',
      'Manage or disable these emails in GhostShopper Settings inside Shopify admin.',
    ].join('\n');
    try {
      const response = await this.request('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `ghostshopper/${claim.id}`,
        },
        body: JSON.stringify({ from: this.config.from, to: [claim.recipient], subject, text }),
      });
      await response.body?.cancel();
      if (response.ok) return 'ACCEPTED';
      return response.status === 429 || response.status === 409 || response.status >= 500
        ? 'RETRY'
        : 'REJECTED';
    } catch {
      return 'RETRY';
    }
  }
}
