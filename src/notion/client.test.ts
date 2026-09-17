import { describe, expect, it } from 'vitest';

import { NotionClient, NOTION_BASE_URL } from './client';
import { NotionUnauthorisedError, NotionUnreachableError } from './errors';
import { fakeFetch } from './test-fetch';

function clientWith(replies: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(replies);
  const client = new NotionClient({
    token: 'ntn_test_token',
    version: '2025-09-03',
    fetch: fake.fetchImpl,
  });
  return { client, requests: fake.requests };
}

const page = (id: string) => ({ id, properties: {} });

describe('the Notion client', () => {
  it('pins the Notion-Version header to the configured version', () => {
    const { client, requests } = clientWith([{ body: { results: [] } }]);

    return client.queryDataSource('ds-budget').then(() => {
      expect(requests[0]?.headers['notion-version']).toBe('2025-09-03');
    });
  });

  it('sends the token as a bearer credential', async () => {
    const { client, requests } = clientWith([{ body: { results: [] } }]);

    await client.queryDataSource('ds-budget');

    expect(requests[0]?.headers.authorization).toBe('Bearer ntn_test_token');
  });

  it('addresses the data source by id, never by database id', async () => {
    const { client, requests } = clientWith([{ body: { results: [] } }]);

    await client.queryDataSource('3ca86094-f992-8055-943e-000b8fecdada');

    expect(requests[0]?.url).toBe(
      `${NOTION_BASE_URL}/data_sources/3ca86094-f992-8055-943e-000b8fecdada/query`,
    );
    expect(requests[0]?.url).not.toContain('/databases/');
  });

  it('accepts any version at or above the minimum the API needs', async () => {
    const fake = fakeFetch([{ body: { results: [] } }]);
    const client = new NotionClient({
      token: 't',
      version: '2025-11-01',
      fetch: fake.fetchImpl,
    });

    await client.queryDataSource('ds');

    expect(fake.requests[0]?.headers['notion-version']).toBe('2025-11-01');
  });

  it('follows pagination to the end and returns every page', async () => {
    const { client, requests } = clientWith([
      { body: { results: [page('a'), page('b')], has_more: true, next_cursor: 'cursor-1' } },
      { body: { results: [page('c')], has_more: false, next_cursor: null } },
    ]);

    const pages = await client.queryDataSource('ds-budget');

    expect(pages.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(requests).toHaveLength(2);
    expect((requests[1]?.body as { start_cursor?: string }).start_cursor).toBe('cursor-1');
  });

  it('stops when a page claims more results but offers no cursor', async () => {
    const { client } = clientWith([
      { body: { results: [page('a')], has_more: true, next_cursor: null } },
    ]);

    // Guards against looping forever on a malformed response.
    await expect(client.queryDataSource('ds')).resolves.toHaveLength(1);
  });

  it('classifies a thrown transport error as unreachable', async () => {
    const { client } = clientWith([new Error('socket hang up')]);

    await expect(client.queryDataSource('ds')).rejects.toBeInstanceOf(NotionUnreachableError);
  });

  it('classifies a rejected token as unauthorised', async () => {
    const { client } = clientWith([{ status: 401, body: { code: 'unauthorized' } }]);

    await expect(client.queryDataSource('ds')).rejects.toBeInstanceOf(NotionUnauthorisedError);
  });

  it('creates a page scoped to the data source', async () => {
    const { client, requests } = clientWith([{ body: { id: 'new', properties: {} } }]);

    const created = await client.createPage('ds-spending', { Name: { title: [] } });

    expect(created.id).toBe('new');
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe(`${NOTION_BASE_URL}/pages`);
    expect((requests[0]?.body as { parent: unknown }).parent).toEqual({
      type: 'data_source_id',
      data_source_id: 'ds-spending',
    });
  });

  it('survives a failure body that is not JSON', async () => {
    const fake = fakeFetch([]);
    const client = new NotionClient({
      token: 't',
      version: '2025-09-03',
      fetch: async () => new Response('<html>bad gateway</html>', { status: 502 }),
    });

    expect(fake.requests).toHaveLength(0);
    await expect(client.queryDataSource('ds')).rejects.toBeInstanceOf(NotionUnreachableError);
  });
});
