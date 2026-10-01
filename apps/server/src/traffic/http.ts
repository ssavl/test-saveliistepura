// Minimal JSON HTTP client for the traffic generator (global fetch, no deps).

export class NetworkError extends Error {}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
}

export class Api {
  requests = 0;
  constructor(readonly baseUrl: string, private readonly timeoutMs = 15_000) {}

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResponse<T>> {
    this.requests++;
    let res: Response;
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      res = await fetch(this.baseUrl.replace(/\/+$/, '') + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      throw new NetworkError(`${method} ${path}: ${cause ?? (e as Error).message}`);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text
    }
    return { status: res.status, ok: res.ok, body: parsed as T };
  }

  get<T = unknown>(path: string, headers?: Record<string, string>) {
    return this.request<T>('GET', path, undefined, headers);
  }
  post<T = unknown>(path: string, body: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', path, body, headers);
  }
  put<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
}

export function describe(res: HttpResponse): string {
  const b = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
  return `HTTP ${res.status} ${(b ?? '').slice(0, 200)}`;
}
