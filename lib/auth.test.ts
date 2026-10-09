import test from "node:test";
import assert from "node:assert/strict";
import { createSession, validSession, sameSecret, sameOrigin } from "./auth";

test("signed sessions expire and reject tampering and rotated passwords", () => {
  const now = 1_700_000_000_000;
  const token = createSession("class-secret", now);
  assert.equal(validSession(token, "class-secret", now + 1000), true);
  assert.equal(validSession(token, "class-secret", now + 13 * 3600_000), false);
  assert.equal(validSession(token, "rotated-secret", now), false);
  assert.equal(validSession(token + ".ignored", "class-secret", now), false);
  assert.equal(validSession("9999999999.fake", "class-secret", now), false);
  assert.equal(validSession(undefined, "class-secret", now), false);
  assert.equal(sameSecret("short", "long-secret"), false);
});

test("origin checks allow the external host when Next normalizes the internal URL", () => {
  assert.equal(
    sameOrigin(
      new Request("http://localhost:3000/api/session", {
        headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      new Request("https://club.example/api/session", {
        headers: { origin: "https://evil.example", host: "club.example" },
      }),
    ),
    false,
  );
});
