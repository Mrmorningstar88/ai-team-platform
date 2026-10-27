// Signed session cookie: "<userId>.<expiresAtMs>.<hmac>", issued by the
// email + password routes in index.ts. Google / Apple sign-in can reuse it.

const encoder = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(secret: string, userId: string, expiresAtMs: number): Promise<string> {
  const payload = `${userId}.${expiresAtMs}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

/** Returns the user id, or null when the token is missing, forged or expired. */
export async function verifySession(secret: string, token: string | undefined, nowMs: number): Promise<string | null> {
  if (!token || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts as [string, string, string];
  const expiresAtMs = Number(expires);
  if (!userId || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null;
  const expected = await hmac(secret, `${userId}.${expires}`);
  return timingSafeEqual(sig, expected) ? userId : null;
}
