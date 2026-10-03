import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate: unauthenticated visitors are redirected to /login before any page renders.
 * This only checks cookie presence — real session validation happens server-side on every request.
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("lifeos_session");
  const { pathname } = req.nextUrl;
  if (!hasSession && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|jpg)$).*)"],
};
