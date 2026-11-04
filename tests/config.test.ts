type Config = typeof import('../src/config').config;

/** Load a fresh copy of the config module with specific environment variables. */
function loadConfig(env: Record<string, string | undefined>): Config {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  let loaded!: Config;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('../src/config').config;
  });
  process.env = saved;
  return loaded;
}

describe('config', () => {
  it('uses safe defaults when nothing is set', () => {
    const config = loadConfig({
      PORT: undefined,
      WEBHOOK_SECRET: undefined,
      ADMIN_API_KEY: undefined,
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      TRUST_PROXY: undefined,
      RATE_LIMIT_MAX: undefined,
      FORWARD_MAX_ATTEMPTS: undefined,
    });
    expect(config.port).toBe(3000);
    expect(config.webhookSecret).toBe('');
    expect(config.adminApiKey).toBe('');
    expect(config.databaseUrl).toBe('');
    expect(config.redisUrl).toBe('');
    expect(config.trustProxy).toBe(0);
    expect(config.rateLimitMax).toBe(120);
    expect(config.forwardMaxAttempts).toBe(5);
    expect(config.defaultPhoneCountry).toBe('IN');
  });

  it('reads numeric settings from the environment', () => {
    const config = loadConfig({ PORT: '8080', TRUST_PROXY: '1', RATE_LIMIT_MAX: '5', FORWARD_MAX_ATTEMPTS: '2' });
    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(1);
    expect(config.rateLimitMax).toBe(5);
    expect(config.forwardMaxAttempts).toBe(2);
  });

  it('falls back to the default for empty or non-numeric values', () => {
    const config = loadConfig({ PORT: 'abc', RATE_LIMIT_MAX: '', TRUST_PROXY: 'NaN' });
    expect(config.port).toBe(3000);
    expect(config.rateLimitMax).toBe(120);
    expect(config.trustProxy).toBe(0);
  });

  it('reads string settings from the environment', () => {
    const config = loadConfig({ WEBHOOK_SECRET: 's3cret', CRM_BASE_URL: 'https://crm.test', DEFAULT_PHONE_COUNTRY: 'US' });
    expect(config.webhookSecret).toBe('s3cret');
    expect(config.crmBaseUrl).toBe('https://crm.test');
    expect(config.defaultPhoneCountry).toBe('US');
  });
});
