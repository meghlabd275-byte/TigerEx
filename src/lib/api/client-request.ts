'use client';

/**
 * Authenticated JSON requests from a client component.
 *
 * The access token is attached here so a view never builds its own header, and
 * a non-2xx response is turned into the server's own message rather than a
 * generic failure. An error is thrown, so a caller must handle it.
 */

import { readAuthToken } from '@/lib/auth/token';

export class ApiError extends Error {
  code: string | null;
  status: number;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function messageFrom(body: unknown, status: number): { message: string; code: string | null } {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string') return { message: error, code: null };
    if (error && typeof error === 'object') {
      const nested = error as Record<string, unknown>;
      const message = typeof nested.message === 'string' ? nested.message : `Request failed (${status})`;
      const code = typeof nested.code === 'string' ? nested.code : null;
      return { message, code };
    }
  }
  return { message: `Request failed (${status})`, code: null };
}

export async function apiRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = readAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { message, code } = messageFrom(body, response.status);
    throw new ApiError(message, response.status, code);
  }
  return body as T;
}
