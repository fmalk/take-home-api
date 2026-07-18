import { loadConfig } from './env.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns defaults when no environment variables are set', () => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.DATA_DIR;
    delete process.env.LOG_LEVEL;
    delete process.env.ENABLE_ADMIN;

    expect(loadConfig()).toEqual({
      PORT: 3000,
      HOST: '0.0.0.0',
      DATA_DIR: './data',
      LOG_LEVEL: 'info',
      ENABLE_ADMIN: true,
    });
  });

  it('reads overrides from environment variables', () => {
    process.env.PORT = '8080';
    process.env.HOST = '127.0.0.1';
    process.env.DATA_DIR = '/tmp/data';
    process.env.LOG_LEVEL = 'debug';
    process.env.ENABLE_ADMIN = 'false';

    expect(loadConfig()).toEqual({
      PORT: 8080,
      HOST: '127.0.0.1',
      DATA_DIR: '/tmp/data',
      LOG_LEVEL: 'debug',
      ENABLE_ADMIN: false,
    });
  });

  it('throws when PORT is not a valid number', () => {
    process.env.PORT = 'not-a-number';

    expect(() => loadConfig()).toThrow('Invalid number for environment variable PORT');
  });

  it.each(['true', '1', 'yes'])('treats ENABLE_ADMIN=%s as true', (value) => {
    process.env.ENABLE_ADMIN = value;

    expect(loadConfig().ENABLE_ADMIN).toBe(true);
  });

  it.each(['false', '0', 'no', 'anything-else'])('treats ENABLE_ADMIN=%s as false', (value) => {
    process.env.ENABLE_ADMIN = value;

    expect(loadConfig().ENABLE_ADMIN).toBe(false);
  });
});
