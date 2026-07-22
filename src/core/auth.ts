import type { FastifyRequest } from 'fastify';
import { faker } from '@faker-js/faker';
import { ApiError } from '../types.js';
import { cacheKey, getCached, setCached } from './cache.js';
import { signJwt, verifyJwt } from './jwt.js';
import { logFlow } from './logger.js';

// Generic OAuth-style login/session fixture: any scenario that needs a login + authenticated
// "current user" endpoint can instantiate this instead of rebuilding the JWT/cache/Faker
// plumbing per scenario. Per-scenario behavior (password rule, cache isolation) is supplied
// via AuthConfig; see travel/v2/routes.ts for the first caller.
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
// Useful later for exercising expiry handling on the caller's side without waiting out a full
// token TTL: a shortLived login still validates the same as any other, it just expires almost
// immediately.
const SHORT_LIVED_TTL_SECONDS = 0.1;

export interface AuthConfig {
  // Isolates this scenario's cached tokens/logs from every other scenario reusing this module.
  namespace: string;
  // Scenario-specific credential rule, e.g. travel's "'tr@vel' + first 5 letters of username".
  passwordFor: (username: string) => string;
  tokenTtlSeconds?: number;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
  avatarUrl: string;
}

export interface LoginBody {
  username: string;
  password: string;
  // When true, issue a token that expires in 100ms instead of the configured tokenTtlSeconds.
  shortLived?: boolean;
}

// OAuth-standard field names (RFC 6749 section 5.1), unlike the rest of this API's camelCase JSON.
export interface LoginResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export type LoginRequest = FastifyRequest<{ Body: LoginBody }>;
export type UserRequest = FastifyRequest;

function hashUsername(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Hunts for a Faker first name starting with the given initial, giving up (and returning
// whatever it landed on) after a bounded number of tries — an occasional initial mismatch is
// the quirk, not a bug; see guessFullName.
function guessFirstName(initial: string): string {
  const target = initial.toUpperCase();
  let candidate = faker.person.firstName();
  for (let attempt = 0; attempt < 40 && candidate.charAt(0).toUpperCase() !== target; attempt++) {
    candidate = faker.person.firstName();
  }
  return candidate;
}

// Approximates a display name from the username itself rather than rolling a fully unrelated
// Faker name: "john.smith"/"john_smith"/"john-smith" splits cleanly into "John Smith"; a bare
// handle with no separator (e.g. "jsmith") is treated as initial + last name, guessing a first
// name that starts with that initial. It's a deliberately imperfect approximation, not a real
// name — for "jsmith" that might land on "Jasper Smith" one run and "June Smith" another.
function guessFullName(username: string): string {
  const handle = username.replace(/\d+$/, '');
  const parts = handle.split(/[._-]+/).filter(Boolean);

  if (parts.length > 1) {
    return parts.map(capitalize).join(' ');
  }

  if (handle.length < 2) {
    return faker.person.fullName();
  }

  const firstName = guessFirstName(handle.charAt(0));
  const lastName = capitalize(handle.slice(1));

  return `${firstName} ${lastName}`;
}

export interface AuthController {
  loginBase(request: LoginRequest): Promise<LoginResult>;
  getUserBase(request: UserRequest): Promise<AuthUser>;
}

export function createAuthController(config: AuthConfig): AuthController {
  const { namespace, passwordFor, tokenTtlSeconds = DEFAULT_TOKEN_TTL_SECONDS } = config;

  function generateUser(username: string): AuthUser {
    // Seeded by username so a fresh generation (cache miss) is still reproducible run-to-run,
    // same trick generator.ts uses to make flight generation deterministic per query.
    faker.seed(hashUsername(username));

    return {
      id: faker.string.uuid(),
      username,
      fullName: guessFullName(username),
      email: faker.internet.email({ firstName: username }).toLowerCase(),
      phone: faker.phone.number({ style: 'international' }),
      avatarUrl: faker.image.avatar(),
    };
  }

  // Cached per username for tokenTtlSeconds so a user who logs in, or is looked up, more than
  // once within that window keeps seeing the same id/profile rather than a fresh Faker roll
  // each call. generateUser is itself deterministic (seeded by username), so a cache miss just
  // means we're recomputing the same values, not fabricating a new identity.
  function getOrCreateUser(username: string): AuthUser {
    const userCacheKey = cacheKey(namespace, 'auth', 'user', username);
    let user = getCached<AuthUser>(userCacheKey);
    if (!user) {
      user = generateUser(username);
      setCached(userCacheKey, user, tokenTtlSeconds);
    }
    return user;
  }

  async function loginBase(request: LoginRequest): Promise<LoginResult> {
    const { username, password, shortLived = false } = request.body;

    if (password !== passwordFor(username)) {
      logFlow({ reqId: request.id, flow: 'auth-login', step: 'rejected', data: { namespace, username } });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    }

    const ttlSeconds = shortLived ? SHORT_LIVED_TTL_SECONDS : tokenTtlSeconds;
    const accessToken = signJwt({ sub: username }, ttlSeconds);
    // Recorded for parity with a real session store (and so an admin surface could list/revoke
    // active tokens later), but this is *not* what makes the token valid — see getUserBase.
    setCached(cacheKey(namespace, 'auth', 'token', accessToken), username, ttlSeconds);
    getOrCreateUser(username);

    logFlow({ reqId: request.id, flow: 'auth-login', step: 'issued', data: { namespace, username, shortLived } });

    return { access_token: accessToken, token_type: 'Bearer', expires_in: ttlSeconds };
  }

  async function getUserBase(request: UserRequest): Promise<AuthUser> {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    // Self-contained: signature + exp are all that's needed to trust the token, same as any
    // real bearer-JWT verification. It must not also require a cache hit (see loginBase).
    const claims = token ? verifyJwt(token) : null;
    const username = typeof claims?.sub === 'string' ? claims.sub : undefined;

    if (!username) {
      logFlow({ reqId: request.id, flow: 'auth-user', step: 'unauthorized', data: { namespace } });
      throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid authorization token');
    }

    logFlow({ reqId: request.id, flow: 'auth-user', step: 'resolved', data: { namespace, username } });

    return getOrCreateUser(username);
  }

  return { loginBase, getUserBase };
}
