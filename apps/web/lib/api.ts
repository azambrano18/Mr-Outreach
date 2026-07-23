import { cookies } from 'next/headers';
import { getApiUrl, SESSION_COOKIE } from './session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Server-only authenticated fetch: attaches the bearer token read from the
 * session cookie. Used both directly from Server Components and from the
 * Route Handlers under app/api/* that proxy the browser to the NestJS API
 * (the BFF pattern — see lib/session.ts for why the token never reaches
 * client-side JS).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = cookies().get(SESSION_COOKIE)?.value;

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body?.error?.message ?? 'Request failed.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
