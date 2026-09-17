import { networkFailure, type NotionError, notionFailure, type NotionFailureBody } from './errors';
import type { NotionProperty } from './properties';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const NOTION_BASE_URL = 'https://api.notion.com/v1';

export interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}

export interface NotionClientOptions {
  token: string;
  /**
   * Pinned explicitly rather than left to a default. `data_source_id` addressing
   * — the only addressing this database supports — requires 2025-09-03 or later,
   * and a silent downgrade would reintroduce the `database_id` ambiguity
   * (`design.md` — "Notion API version drift").
   */
  version: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

interface QueryResponse {
  results: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  kind: 'read' | 'write';
  body?: unknown;
  relationProperty?: string;
}

/**
 * A thin, explicitly-versioned Notion client.
 *
 * Every call is scoped to a **data source ID**, never a database ID: the live
 * Budget database has more than one data source, so `database_id` is ambiguous
 * (`design.md`, Context). The client holds no knowledge of *which* properties
 * matter — that is configuration, and it belongs to the repositories.
 */
export class NotionClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly options: NotionClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = options.baseUrl ?? NOTION_BASE_URL;
  }

  /** Every page of a data source, following pagination to the end. */
  async queryDataSource(dataSourceId: string): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor !== undefined) {
        body.start_cursor = cursor;
      }

      const response = await this.request<QueryResponse>(`/data_sources/${dataSourceId}/query`, {
        method: 'POST',
        kind: 'read',
        body,
      });

      pages.push(...(response.results ?? []));
      cursor =
        response.has_more === true && typeof response.next_cursor === 'string'
          ? response.next_cursor
          : undefined;
    } while (cursor !== undefined);

    return pages;
  }

  /** Creates one row under a data source. Appends only; never updates. */
  async createPage(
    dataSourceId: string,
    properties: Record<string, NotionProperty>,
    options: { relationProperty?: string } = {},
  ): Promise<NotionPage> {
    return this.request<NotionPage>('/pages', {
      method: 'POST',
      kind: 'write',
      relationProperty: options.relationProperty,
      body: {
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties,
      },
    });
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          'Notion-Version': this.options.version,
          'Content-Type': 'application/json',
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (cause) {
      throw networkFailure(cause);
    }

    if (!response.ok) {
      throw this.failureFor(response.status, await readFailureBody(response), options);
    }

    return (await response.json()) as T;
  }

  private failureFor(
    status: number,
    body: NotionFailureBody | undefined,
    options: RequestOptions,
  ): NotionError {
    return notionFailure(status, body, {
      kind: options.kind,
      ...(options.relationProperty === undefined
        ? {}
        : { relationProperty: options.relationProperty }),
    });
  }
}

async function readFailureBody(response: Response): Promise<NotionFailureBody | undefined> {
  try {
    return (await response.json()) as NotionFailureBody;
  } catch {
    return undefined;
  }
}
