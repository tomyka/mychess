function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64url(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hashes an OIDC nonce as lowercase hex SHA-256 — the encoding Google's native
 * Sign-In / One Tap convention uses (and what Supabase's signInWithIdToken
 * expects when re-hashing the raw nonce to compare against the ID token's
 * `nonce` claim). Deliberately separate from generateCodeChallenge, which
 * uses base64url per RFC 7636 for PKCE — the two encodings must not be mixed.
 */
export async function hashNonce(nonce: string): Promise<string> {
  const encoded = new TextEncoder().encode(nonce);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(new Uint8Array(digest));
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64url(new Uint8Array(sig));
}

function base64urlDecode(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacVerify(secret: string, message: string, sig: string): Promise<boolean> {
  const decoded = base64urlDecode(sig);
  if (decoded === null) return false;
  const sigBytes = new Uint8Array(decoded);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(message));
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function createState(
  userId: string,
  secret: string,
  nonce?: string,
  timestamp?: number
): Promise<string> {
  const n = nonce ?? randomNonce();
  const ts = timestamp ?? Date.now();
  const payload = `${userId}:${n}:${ts}`;
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyState(state: string, secret: string): Promise<string> {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) throw new Error('invalid state format');
  const payload = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const valid = await hmacVerify(secret, payload, sig);
  if (!valid) throw new Error('invalid state signature');
  const parts = payload.split(':');
  if (parts.length < 3) throw new Error('invalid state format');
  const ts = parseInt(parts[parts.length - 1], 10);
  if (isNaN(ts)) throw new Error('invalid state format');
  if (Date.now() - ts > 5 * 60 * 1000) throw new Error('state expired');
  // userId may contain colons (e.g. Supabase UUIDs don't, but guard anyway)
  return parts.slice(0, -2).join(':');
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid JWT structure');
  const bytes = base64urlDecode(parts[1]);
  if (!bytes) throw new Error('invalid JWT payload encoding');
  return JSON.parse(new TextDecoder().decode(bytes));
}
