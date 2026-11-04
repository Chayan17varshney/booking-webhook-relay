const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
  defaultPhoneCountry: process.env.DEFAULT_PHONE_COUNTRY ?? 'IN',
  /** Number of reverse proxies in front of the app (so req.ip is the real client). 0 = none. */
  trustProxy: num(process.env.TRUST_PROXY, 0),
  idempotencyTtlSeconds: num(process.env.IDEMPOTENCY_TTL_SECONDS, 24 * 60 * 60),
  rateLimitMax: num(process.env.RATE_LIMIT_MAX, 120),
  rateLimitWindowSeconds: num(process.env.RATE_LIMIT_WINDOW_SECONDS, 60),
  crmBaseUrl: process.env.CRM_BASE_URL ?? '',
  crmApiKey: process.env.CRM_API_KEY ?? '',
  forwardMaxAttempts: num(process.env.FORWARD_MAX_ATTEMPTS, 5),
};
