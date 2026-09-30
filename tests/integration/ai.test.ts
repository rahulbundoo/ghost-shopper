import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAiProvider } from '../../packages/ai/src/index.js';
import { aiInput, aiResult } from '../fixtures/ai.js';
let endpoint: string;
let requests = 0;
let requestBody: Record<string, unknown> = {};
let authorization: string | undefined;
let mode: 'success' | 'invalid' | 'redirect' = 'success';
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    requests++;
    authorization = request.headers.authorization;
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    if (mode === 'redirect') {
      response.writeHead(302, { Location: `${endpoint}/forbidden` }).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        status: 'completed',
        usage: { input_tokens: 40, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } },
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: mode === 'invalid' ? '{broken' : JSON.stringify(aiResult),
              },
            ],
          },
        ],
      }),
    );
  });
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_FAILED');
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function provider() {
  return new OpenAiProvider(
    {
      apiKey: 'fixture-not-a-real-key',
      model: 'fixture-model',
      timeoutMs: 1000,
      maxOutputTokens: 256,
      pricing: { input: 2, cachedInput: 1, output: 10 },
    },
    (url, init) => {
      // Test-only transport redirects the fixed API endpoint to a controlled HTTP fixture.
      expect(url).toBe('https://api.openai.com/v1/responses');
      return fetch(endpoint, init);
    },
  );
}
describe('AI HTTP wire contract (controlled server, no paid API calls)', () => {
  it('sends structured multimodal input and parses real HTTP response bytes', async () => {
    mode = 'success';
    const result = await provider().analyzeJourney(aiInput);
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      result: aiResult,
      estimatedCostUsd: '0.00028000',
    });
    expect(authorization).toBe('Bearer fixture-not-a-real-key');
    expect(requestBody).toMatchObject({
      model: 'fixture-model',
      store: false,
      text: { format: { strict: true } },
    });
    expect(JSON.stringify(requestBody)).not.toContain('fixture-not-a-real-key');
  });
  it('retains usage for malformed JSON results', async () => {
    mode = 'invalid';
    expect(await provider().analyzeJourney(aiInput)).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_INVALID_OUTPUT',
      result: null,
      estimatedCostUsd: '0.00028000',
    });
  });
  it('never forwards authorization through a redirect or retries', async () => {
    mode = 'redirect';
    const previous = requests;
    expect((await provider().analyzeJourney(aiInput)).errorCode).toBe('AI_PROVIDER_ERROR');
    expect(requests - previous).toBe(1);
  });
});
