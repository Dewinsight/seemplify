import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Hostnames whose root path ("/") should redirect to "/login".
 * The landing page is not useful for dedicated-portal deployments.
 */
const DIRECT_TO_LOGIN_PATTERNS = ['jetstone'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only intercept root requests
  if (pathname !== '/') {
    return NextResponse.next();
  }

  const hostname = request.headers.get('host') ?? '';
  const lower = hostname.toLowerCase();

  const shouldRedirect = DIRECT_TO_LOGIN_PATTERNS.some((p) =>
    lower.includes(p.toLowerCase())
  );

  if (shouldRedirect) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  return NextResponse.next();
}

export const config = {
  // Only run on the root path — avoids intercepting every request
  matcher: ['/'],
};
