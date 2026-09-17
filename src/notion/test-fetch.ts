import type { FetchLike } from './client';

/**
 * A `fetch` stand-in for tests. Test-only; nothing in the application imports it.
 *
 * Every call is recorded so a test can assert what was actually sent — which is
 * the only way to prove things like "the version header is pinned" or "no
 * formula property was written" without touching the live API.
 */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type StubReply = { status?: number; body?: unknown } | Error;

export interface FakeFetch {
  fetchImpl: FetchLike;
  requests: RecordedRequest[];
}

export function fakeFetch(replies: StubReply[]): FakeFetch {
  const requests: RecordedRequest[] = [];
  let call = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: normaliseHeaders(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;

    if (reply instanceof Error) {
      throw reply;
    }

    return new Response(JSON.stringify(reply?.body ?? {}), {
      status: reply?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchImpl, requests };
}

function normaliseHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  return Object.fromEntries(new Headers(headers).entries());
}
