import { cookies } from 'next/headers';
import type { AuthenticatedUser } from '@outreach/shared-types';

export const SESSION_COOKIE = 'session';

export function getApiUrl(): string {
  return process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

/**
 * Server-only. Reads the httpOnly session cookie (set by
 * /api/auth/login) and resolves the current user by calling the API's
 * /auth/me — never trusts anything cached client-side, so a disabled
 * user or a changed permission is reflected on the very next request.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${getApiUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as AuthenticatedUser;
  } catch {
    return null;
  }
}
