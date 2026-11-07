import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export async function middleware(request: NextRequest) {
  if (!auth0) return NextResponse.next();
  const res = await auth0.middleware(request);
  const path = request.nextUrl.pathname;
  if (path.startsWith("/auth") || path === "/terms" || path === "/privacy") return res;
  const session = await auth0.getSession(request);
  if (!session) return NextResponse.redirect(new URL(`/auth/login?returnTo=${request.nextUrl.pathname}`, request.url));
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"] };
