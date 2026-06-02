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

async function hmacVerify(secret: string, message: string, sig: string): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
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
  if (Date.now() - ts > 5 * 60 * 1000) throw new Error('state expired');
  // userId may contain colons (e.g. Supabase UUIDs don't, but guard anyway)
  return parts.slice(0, -2).join(':');
}
