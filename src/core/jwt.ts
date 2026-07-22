import { createHmac, timingSafeEqual } from 'crypto';
import { getEnv } from '../config/env.js';

// Hand-rolled HS256 JWT (header.payload.signature, base64url, HMAC-SHA256): the standard's
// mechanics are a handful of lines over Node's built-in crypto, so this avoids pulling in a
// dependency just to fixture a login endpoint (see CLAUDE.md's DIY philosophy).
const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return createHmac('sha256', getEnv('JWT_SECRET', 'dev-oauth-fixture-secret')).update(data).digest('base64url');
}

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export function signJwt(claims: Record<string, unknown>, ttlSeconds: number): string {
  const nowMs = Date.now();
  // exp is kept in fractional seconds (not rounded to the nearest whole second like a strict
  // NumericDate) so sub-second ttlSeconds — e.g. a 100ms short-lived token — actually expire
  // when they're supposed to, instead of always rounding up to at least a full second.
  const payload = base64url(
    JSON.stringify({ ...claims, iat: Math.floor(nowMs / 1000), exp: nowMs / 1000 + ttlSeconds }),
  );
  const signingInput = `${HEADER}.${payload}`;
  return `${signingInput}.${sign(signingInput)}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expectedSignature = sign(`${header}.${payload}`);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let claims: JwtPayload;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  // Compared at full (millisecond) precision to match signJwt's fractional-second exp.
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
    return null;
  }

  return claims;
}
