import { ExtractionError } from './draft';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface DeepSeekClientOptions {
  apiKey: string;
  /**
   * Must accept images: `deepseek-v4-pro` is text-only, and a receipt is the
   * primary input (`design.md` — "DeepSeek model IDs churn").
   */
  modelId: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Sent as the response format's name; the model does not see it otherwise. */
  schemaName?: string;
}

export interface CompletionRequest {
  system: string;
  contents: ContentPart[];
  /** JSON schema the reply must satisfy. */
  responseSchema: Record<string, unknown>;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/**
 * The DeepSeek client, over its OpenAI-compatible Chat Completions endpoint.
 *
 * This is transport only: it sends the request and hands back the parsed JSON
 * envelope's content as an unknown value. Validating that content against the
 * draft schema is the caller's job, so "the model answered" and "the model
 * answered something usable" stay distinct failures.
 */
export class DeepSeekClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly schemaName: string;

  constructor(private readonly options: DeepSeekClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = options.baseUrl ?? DEEPSEEK_BASE_URL;
    this.schemaName = options.schemaName ?? 'draft_expense';
  }

  /** Returns the model's reply parsed as JSON, or throws. */
  async complete(request: CompletionRequest): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.modelId,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.contents },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: this.schemaName,
              schema: request.responseSchema,
              strict: true,
            },
          },
        }),
      });
    } catch (cause) {
      throw new ExtractionError('model-unreachable', 'Could not reach the extraction model', {
        cause,
      });
    }

    if (!response.ok) {
      throw new ExtractionError(
        'model-unreachable',
        `The extraction model refused the request (${response.status})`,
        { cause: new Error(await describe(response)) },
      );
    }

    const body = (await readJson(response)) as ChatCompletion;
    const content = body.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim() === '') {
      throw new ExtractionError('invalid-response', 'The extraction model returned no content');
    }

    try {
      return JSON.parse(content) as unknown;
    } catch (cause) {
      throw new ExtractionError(
        'invalid-response',
        'The extraction model returned content that is not JSON',
        { cause },
      );
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function describe(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}
