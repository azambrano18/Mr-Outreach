import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from './lib/session';

/**
 * Cheap presence check only (no token verification here — that happens
 * server-side via /auth/me, which also re-checks the user is still
 * active). This just keeps a logged-out browser from ever rendering the
 * dashboard shell before being redirected.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Forwarded so the dashboard layout (a Server Component with no other way
  // to read the current path) can tell whether it's already rendering
  // /dashboard/change-password before deciding to redirect there.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
