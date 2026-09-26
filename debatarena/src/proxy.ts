import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isValidAuth } from "@/lib/auth";

const PUBLIC = [/^\/login/, /^\/api\/login/, /^\/replay\//, /^\/api\/public\//];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  if (await isValidAuth(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Je bent niet ingelogd.", oplossing: "Log opnieuw in met het wachtwoord van de app." },
      { status: 401 },
    );
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
