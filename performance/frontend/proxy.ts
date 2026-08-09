import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public paths that don't require authentication
const publicPaths = ['/login', '/api/auth'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The legacy ReviewCycle/PerformanceReview interface is read-only during
  // migration and no longer has a writable UI. Preserve old bookmarks by
  // taking users to the canonical Appraisal screens.
  if (pathname === '/team/reviews' || pathname.startsWith('/team/reviews/')) {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname.replace(/^\/team\/reviews/, '/team/appraisals');
    return NextResponse.redirect(destination);
  }
  if (pathname === '/admin/review-cycles' || pathname.startsWith('/admin/review-cycles/')) {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname.replace(/^\/admin\/review-cycles/, '/admin/appraisal-cycles');
    return NextResponse.redirect(destination);
  }
  if (pathname === '/reviews' || pathname.startsWith('/reviews/')) {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname.replace(/^\/reviews/, '/appraisals');
    return NextResponse.redirect(destination);
  }

  if (publicPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith('/_next')
    || pathname.startsWith('/favicon')
    || pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // AuthContext performs the token check and sends unauthenticated users to
  // login. Keeping that single source avoids competing OIDC session systems.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
