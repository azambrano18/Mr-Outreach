import { NextRequest, NextResponse } from 'next/server';
import type { LoginResult } from '@outreach/shared-types';
import { getApiUrl, SESSION_COOKIE } from '../../../../lib/session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // matches the API's JWT expiresIn: '8h'

/**
 * Thin server-to-server proxy (BFF pattern): the browser never sees the
 * access token. This route calls the NestJS API directly (no CORS
 * involved, since this runs on the server) and stores the token in an
 * httpOnly cookie scoped to this Next.js origin instead.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const credentials = await request.json();

  const apiResponse = await fetch(`${getApiUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.json().catch(() => ({}));
    return NextResponse.json(errorBody, { status: apiResponse.status });
  }

  const { accessToken, user } = (await apiResponse.json()) as LoginResult;

  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
