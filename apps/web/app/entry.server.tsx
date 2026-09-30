import { PassThrough } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { createReadableStreamFromReadable } from '@react-router/node';
import { ServerRouter, type EntryContext } from 'react-router';
import { documentHeaders, reportFailure } from './shopify.server';

export const streamTimeout = 5_000;
export default function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  documentHeaders(request, headers);
  return new Promise<Response>((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={context} url={request.url} />,
      {
        onAllReady() {
          if (timer) clearTimeout(timer);
          const body = new PassThrough();
          headers.set('Content-Type', 'text/html; charset=utf-8');
          resolve(new Response(createReadableStreamFromReadable(body), { status, headers }));
          pipe(body);
        },
        onShellError() {
          if (timer) clearTimeout(timer);
          reject(new Error('Unable to render GhostShopper.'));
        },
        onError() {
          status = 500;
          reportFailure('web.render.failed', 'RENDER_FAILED');
        },
      },
    );
    const timer = setTimeout(abort, streamTimeout + 1_000);
  });
}
