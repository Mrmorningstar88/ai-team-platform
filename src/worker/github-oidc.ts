// Verifies the OpenID Connect token a GitHub Actions job gets with
// `permissions: id-token: write`. The token proves which repository and branch
// the job runs in, so a workflow can report to us without any shared secret.

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const JWKS_TTL_MS = 60 * 60_000;

export interface GithubClaims { repository: string; ref: string }
export interface Jwks { keys: (JsonWebKey & { kid?: string })[] }

let cached: { jwks: Jwks; at: number } | null = null;

async function githubJwks(now: number): Promise<Jwks> {
  if (cached && now - cached.at < JWKS_TTL_MS) return cached.jwks;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const jwks = (await res.json()) as Jwks;
  cached = { jwks, at: now };
  return jwks;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
const json = (part: string): unknown => JSON.parse(new TextDecoder().decode(b64url(part)));

/** The token's repository and ref, or null when it is not a valid GitHub token for `audience`. */
export async function verifyGithubToken(
  token: string,
  audience: string,
  now = Date.now(),
  jwks?: Jwks,
): Promise<GithubClaims | null> {
  try {
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return null;
    const header = json(h) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") return null;
    const keys = (jwks ?? (await githubJwks(now))).keys;
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const c = json(p) as { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; repository?: string; ref?: string };
    const auds = Array.isArray(c.aud) ? c.aud : [c.aud];
    const sec = now / 1000;
    if (c.iss !== ISSUER || !auds.includes(audience)) return null;
    if (typeof c.exp !== "number" || c.exp < sec || (typeof c.nbf === "number" && c.nbf > sec + 60)) return null;
    if (typeof c.repository !== "string" || typeof c.ref !== "string") return null;
    return { repository: c.repository, ref: c.ref };
  } catch {
    return null;
  }
}
