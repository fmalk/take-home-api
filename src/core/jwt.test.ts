import { signJwt, verifyJwt } from './jwt.js';

describe('jwt', () => {
  describe('signJwt / verifyJwt', () => {
    it('round-trips claims through a valid token', () => {
      const token = signJwt({ sub: 'jsmith' }, 3600);

      expect(verifyJwt(token)?.sub).toBe('jsmith');
    });

    it('produces a standard header.payload.signature token', () => {
      const token = signJwt({ sub: 'jsmith' }, 3600);

      expect(token.split('.')).toHaveLength(3);
    });

    it('sets iat/exp based on the given ttl', () => {
      const before = Math.floor(Date.now() / 1000);
      const token = signJwt({ sub: 'jsmith' }, 60);
      const claims = verifyJwt(token);

      expect(claims?.exp).toBeGreaterThanOrEqual(before + 60);
      expect(claims?.exp).toBeLessThanOrEqual(before + 61);
    });

    it('rejects a token with a tampered payload', () => {
      const token = signJwt({ sub: 'jsmith' }, 3600);
      const [header, , signature] = token.split('.');
      const forgedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', iat: 0, exp: 9999999999 })).toString(
        'base64url',
      );

      expect(verifyJwt(`${header}.${forgedPayload}.${signature}`)).toBeNull();
    });

    it('rejects a token with a tampered signature', () => {
      const token = signJwt({ sub: 'jsmith' }, 3600);
      const [header, payload] = token.split('.');

      expect(verifyJwt(`${header}.${payload}.not-a-valid-signature`)).toBeNull();
    });

    it('rejects an expired token', () => {
      const token = signJwt({ sub: 'jsmith' }, -1);

      expect(verifyJwt(token)).toBeNull();
    });

    it('supports sub-second ttl (e.g. a 100ms short-lived token)', async () => {
      const token = signJwt({ sub: 'jsmith' }, 0.1);

      expect(verifyJwt(token)?.sub).toBe('jsmith');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(verifyJwt(token)).toBeNull();
    });

    it('rejects a malformed token', () => {
      expect(verifyJwt('not-a-jwt')).toBeNull();
    });
  });
});
