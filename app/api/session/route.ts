import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  COOKIE_NAME,
  sameSecret,
  createSession,
  validSession,
  localWithoutPassword,
  sameOrigin,
  allowRequest,
} from "@/lib/auth";
export async function GET() {
  const secret = process.env.CLUB_PASSWORD;
  const authenticated =
    localWithoutPassword() ||
    Boolean(
      secret && validSession((await cookies()).get(COOKIE_NAME)?.value, secret),
    );
  return NextResponse.json(
    { authenticated },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return new Response("Invalid origin", { status: 403 });
  if (
    !allowRequest(
      `login:${request.headers.get("x-forwarded-for") || "local"}`,
      10,
      60_000,
    )
  )
    return new Response("Too many attempts. Try again in a minute.", {
      status: 429,
    });
  const secret = process.env.CLUB_PASSWORD;
  if (!secret)
    return new Response("Class access is not configured yet.", { status: 503 });
  let password;
  try {
    const raw = await request.text();
    if (raw.length > 1000)
      return new Response("Request too large", { status: 413 });
    password = JSON.parse(raw).password;
  } catch {
    return new Response("Enter a class passcode.", { status: 400 });
  }
  if (typeof password !== "string" || !sameSecret(password, secret))
    return new Response("That passcode does not match. Try again.", {
      status: 401,
    });
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(COOKIE_NAME, createSession(secret), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 43200,
  });
  return response;
}
