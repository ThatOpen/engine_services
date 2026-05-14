/**
 * Parses an API error body. The platform returns `{ message, code?, details? }`
 * as JSON on failures; non-JSON bodies (proxies, gateways, plain text) yield an
 * empty result so the caller falls back to the status line.
 */
function parseErrorBody(body: string): {
  message?: string;
  code?: string;
  details?: unknown;
} {
  try {
    const json: unknown = JSON.parse(body);
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      return {
        message: typeof obj.message === 'string' ? obj.message : undefined,
        code: typeof obj.code === 'string' ? obj.code : undefined,
        details: obj.details,
      };
    }
  } catch {}
  return {};
}

/**
 * Error thrown by {@link EngineServicesClient} when the platform API responds
 * with a non-2xx status. Exposes the HTTP `status` and — when the API returns a
 * structured JSON body — its `code` and `details`, so callers can react to
 * specific failures (e.g. `code === 'LIMIT_EXCEEDED'`) instead of string-
 * matching the message.
 *
 * @example
 * ```ts
 * try {
 *   await client.createComponent(props);
 * } catch (err) {
 *   if (err instanceof RequestError && err.code === 'LIMIT_EXCEEDED') {
 *     console.error(err.message); // "Components limit reached (10/10)..."
 *   }
 * }
 * ```
 */
export class RequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    const parsed = parseErrorBody(body);
    super(parsed.message ?? `${statusText || 'Request failed'} (${status})`);
    this.name = 'RequestError';
    this.status = status;
    this.code = parsed.code;
    this.details = parsed.details;
    this.body = body;
  }
}
