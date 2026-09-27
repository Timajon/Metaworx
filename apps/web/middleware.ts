import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const token = process.env.SIGNALFORGE_ACCESS_TOKEN;
  if (!local && !token) {
    return new NextResponse("SignalForge refuses non-local access until SIGNALFORGE_ACCESS_TOKEN is set.", { status: 503 });
  }
  if (!token) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path.startsWith("/login") || path.startsWith("/api/login")) return NextResponse.next();
  const expected = await sha256(token);
  if (request.cookies.get("sf_session")?.value === expected) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
