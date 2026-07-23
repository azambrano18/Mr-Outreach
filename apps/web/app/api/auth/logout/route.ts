import { NextResponse } from 'next/server';
import { getApiUrl, SESSION_COOKIE } from '../../../../lib/session';
import { cookies } from 'next/headers';

export async function POST(): Promise<NextResponse> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    // Best-effort: stateless JWT today, so this has no server-side effect
    // yet, but keeps the call site ready for when the API gains real
    // revocation (see apps/api auth.controller.ts logout comment).
    await fetch(`${getApiUrl()}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ status: 'ok' });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
