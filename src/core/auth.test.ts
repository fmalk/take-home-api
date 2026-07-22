import type { FastifyRequest } from 'fastify';
import { initCache } from './cache.js';
import { createAuthController, type LoginBody, type LoginRequest, type UserRequest } from './auth.js';

const { loginBase, getUserBase } = createAuthController({
  namespace: 'test-scenario',
  passwordFor: (username) => `tr@vel${username.slice(0, 5)}`,
});

function makeLoginRequest(body: LoginBody): LoginRequest {
  return { id: 'req-1', body } as LoginRequest;
}

function makeUserRequest(authorization?: string): UserRequest {
  return { id: 'req-1', headers: { authorization } } as unknown as FastifyRequest;
}

describe('auth', () => {
  beforeEach(() => {
    initCache();
  });

  describe('loginBase', () => {
    it("issues a bearer token when the password matches 'tr@vel' + first 5 letters of the username", async () => {
      const result = await loginBase(makeLoginRequest({ username: 'jsmith', password: 'tr@veljsmit' }));

      expect(result.token_type).toBe('Bearer');
      expect(result.expires_in).toBe(3600);
      expect(result.access_token.split('.')).toHaveLength(3);
    });

    it('rejects a password that does not match the expected pattern', async () => {
      await expect(loginBase(makeLoginRequest({ username: 'jsmith', password: 'wrong' }))).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('derives the password from only the first 5 letters of the username', async () => {
      await expect(loginBase(makeLoginRequest({ username: 'jsmith', password: 'tr@veljsmith' }))).rejects.toMatchObject(
        { status: 401 },
      );
    });
  });

  describe('getUserBase', () => {
    it('returns a Faker-generated user for a token issued by loginBase', async () => {
      const { access_token: accessToken } = await loginBase(
        makeLoginRequest({ username: 'jsmith', password: 'tr@veljsmit' }),
      );

      const user = await getUserBase(makeUserRequest(`Bearer ${accessToken}`));

      expect(user.username).toBe('jsmith');
      expect(user).toMatchObject({
        id: expect.any(String),
        fullName: expect.any(String),
        email: expect.any(String),
      });
    });

    it('keeps the same user identity across repeated logins within the cache TTL', async () => {
      const { access_token: token1 } = await loginBase(
        makeLoginRequest({ username: 'jsmith', password: 'tr@veljsmit' }),
      );
      const user1 = await getUserBase(makeUserRequest(`Bearer ${token1}`));

      const { access_token: token2 } = await loginBase(
        makeLoginRequest({ username: 'jsmith', password: 'tr@veljsmit' }),
      );
      const user2 = await getUserBase(makeUserRequest(`Bearer ${token2}`));

      expect(user2).toEqual(user1);
    });

    it('serves the cached user record rather than regenerating it on every lookup', async () => {
      const { getCached, setCached, cacheKey } = await import('./cache.js');
      const { access_token: accessToken } = await loginBase(
        makeLoginRequest({ username: 'jsmith', password: 'tr@veljsmit' }),
      );

      const cachedKey = cacheKey('test-scenario', 'auth', 'user', 'jsmith');
      const cachedUser = getCached<{ id: string }>(cachedKey);
      setCached(cachedKey, { ...cachedUser, id: 'pinned-id' });

      const user = await getUserBase(makeUserRequest(`Bearer ${accessToken}`));

      expect(user.id).toBe('pinned-id');
    });

    it('rejects a missing Authorization header', async () => {
      await expect(getUserBase(makeUserRequest())).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    });

    it('rejects a malformed Authorization header', async () => {
      await expect(getUserBase(makeUserRequest('not-a-bearer-token'))).rejects.toMatchObject({ status: 401 });
    });

    it('rejects a token that was never issued (not in cache)', async () => {
      const { signJwt } = await import('./jwt.js');
      const forged = signJwt({ sub: 'jsmith' }, 3600);

      await expect(getUserBase(makeUserRequest(`Bearer ${forged}`))).rejects.toMatchObject({ status: 401 });
    });

    it('rejects a token once it has been evicted from the cache', async () => {
      const { access_token: accessToken } = await loginBase(
        makeLoginRequest({ username: 'jsmith', password: 'tr@veljsmit' }),
      );

      initCache(); // simulate the token's cache entry expiring/being cleared

      await expect(getUserBase(makeUserRequest(`Bearer ${accessToken}`))).rejects.toMatchObject({ status: 401 });
    });
  });
});
