import { createHmac, timingSafeEqual, createHash } from "node:crypto";
export const COOKIE_NAME = "podcast-club-session";
const TTL_SECONDS = 60 * 60 * 12;

export function sameSecret(a: string, b: string) {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}
export function createSession(secret: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + TTL_SECONDS);
  return `${expires}.${createHmac("sha256", secret).update(`podcast-club:${expires}`).digest("hex")}`;
}
export function validSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
) {
  if (!token) return false;
  const [expires, signature, extra] = token.split(".");
  if (
    extra ||
    !/^\d+$/.test(expires) ||
    !/^[a-f0-9]{64}$/.test(signature || "")
  )
    return false;
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > TTL_SECONDS) return false;
  const expected = createHmac("sha256", secret)
    .update(`podcast-club:${expires}`)
    .digest("hex");
  return sameSecret(signature, expected);
}
export function localWithoutPassword() {
  return (
    !process.env.VERCEL &&
    process.env.NODE_ENV === "development" &&
    !process.env.CLUB_PASSWORD
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    // Next may normalize request.url to an internal hostname. Compare the browser Origin
    // with the incoming Host instead; browsers cannot override that header.
    const source = new URL(origin);
    return (
      ["http:", "https:"].includes(source.protocol) &&
      source.host === (request.headers.get("host") || new URL(request.url).host)
    );
  } catch {
    return false;
  }
}

// Best-effort per-instance limits. The class passcode is the primary access control.
const buckets = new Map<string, { count: number; reset: number }>();
export function allowRequest(key: string, maximum: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > 5000)
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  const existing = buckets.get(key);
  if (!existing || existing.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  existing.count++;
  return existing.count <= maximum;
}
