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
      fullName: faker.person.fullName(),
      email: faker.internet.email({ firstName: username }),
      phone: faker.phone.number(),
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
    const { username, password } = request.body;

    if (password !== passwordFor(username)) {
      logFlow({ reqId: request.id, flow: 'auth-login', step: 'rejected', data: { namespace, username } });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    }

    const accessToken = signJwt({ sub: username }, tokenTtlSeconds);
    // The cache, not just the JWT signature, is the source of truth for validity: it lets a
    // token be looked up (and, in principle, revoked) independently of its own exp claim.
    setCached(cacheKey(namespace, 'auth', 'token', accessToken), username, tokenTtlSeconds);
    getOrCreateUser(username);

    logFlow({ reqId: request.id, flow: 'auth-login', step: 'issued', data: { namespace, username } });

    return { access_token: accessToken, token_type: 'Bearer', expires_in: tokenTtlSeconds };
  }

  async function getUserBase(request: UserRequest): Promise<AuthUser> {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    const claims = token ? verifyJwt(token) : null;
    const username = token ? getCached<string>(cacheKey(namespace, 'auth', 'token', token)) : undefined;

    if (!claims || !username) {
      logFlow({ reqId: request.id, flow: 'auth-user', step: 'unauthorized', data: { namespace } });
      throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid authorization token');
    }

    logFlow({ reqId: request.id, flow: 'auth-user', step: 'resolved', data: { namespace, username } });

    return getOrCreateUser(username);
  }

  return { loginBase, getUserBase };
}
