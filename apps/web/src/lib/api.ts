import { storage } from './storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
export const ADMIN_TOKEN_KEY = 'funnel:adminToken';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  admin?: boolean;
}

/** JSON request helper. Throws ApiError for non-2xx (status 0 = network error/timeout). */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.admin) {
    const token = storage.get(ADMIN_TOKEN_KEY);
    if (token) headers['x-admin-token'] = token;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new ApiError(0, null, controller.signal.aborted ? 'Сервер не ответил вовремя' : 'Нет связи с сервером');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; message?: unknown };
    const msg = String(b.error ?? b.message ?? `HTTP ${res.status}`);
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.status === 401 ? 'Нужен корректный admin token' : e.message;
  return e instanceof Error ? e.message : String(e);
}
