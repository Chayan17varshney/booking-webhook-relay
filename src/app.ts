import express, { type RequestHandler } from 'express';
import { requireApiKey } from './auth';
import { config } from './config';
import type { EventRepository } from './events/repository';
import { isStatus } from './events/status';
import type { IdempotencyStore } from './redis/idempotency';
import type { RateLimiter } from './redis/rateLimiter';
import { parseBookingEvent } from './webhook/schema';
import { verifySignature } from './webhook/signature';

export interface AppOptions {
  /** Shared secret used to verify webhook signatures. Defaults to WEBHOOK_SECRET. */
  webhookSecret?: string;
  /** Key required on the read endpoints (GET /events). Defaults to ADMIN_API_KEY. */
  adminApiKey?: string;
  /** Event storage. When omitted, webhooks are validated but not stored and /events is not served. */
  events?: EventRepository;
  /** Fast duplicate detection in front of Postgres (optional). */
  idempotency?: IdempotencyStore;
  /** Per-client rate limit on the webhook endpoint (optional). */
  rateLimiter?: RateLimiter;
  /** Called with an event id when it should be forwarded to the CRM (new event, or a replay). */
  dispatch?: (eventId: string) => void;
  /** Reverse proxies in front of the app, for req.ip. Defaults to TRUST_PROXY. */
  trustProxy?: number;
  /** Folder containing the built dashboard; when set it is served at /dashboard. */
  dashboardDir?: string;
}

// The dashboard loads only its own scripts and styles and talks only to this origin.
const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SIGNATURE_HEADER = 'x-webhook-signature';

function parseIntParam(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export function createApp(options: AppOptions = {}) {
  const webhookSecret = options.webhookSecret ?? config.webhookSecret;
  const adminApiKey = options.adminApiKey ?? config.adminApiKey;
  const { events, idempotency, rateLimiter, dispatch } = options;
  const app = express();
  app.set('trust proxy', options.trustProxy ?? config.trustProxy);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (options.dashboardDir) {
    app.use(
      '/dashboard',
      (_req, res, next) => {
        res.setHeader('Content-Security-Policy', DASHBOARD_CSP);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
      },
      express.static(options.dashboardDir),
    );
    app.get('/', (_req, res) => {
      res.redirect('/dashboard/');
    });
  }

  // Shed excess traffic before doing any body parsing or crypto. If Redis is down we let the
  // request through (fail open): signature verification still protects the endpoint.
  const rateLimit: RequestHandler = async (req, res, next) => {
    if (!rateLimiter) {
      next();
      return;
    }
    try {
      const result = await rateLimiter.hit(req.ip ?? 'unknown');
      res.setHeader('RateLimit-Limit', String(result.limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
    } catch (err) {
      console.error('Rate limiter unavailable, allowing request:', err instanceof Error ? err.message : err);
    }
    next();
  };

  // The signature is computed over the exact bytes sent, so this route reads the RAW body
  // (express.raw) and only parses JSON after the signature has been verified.
  app.post('/webhooks/bookings', rateLimit, express.raw({ type: 'application/json' }), async (req, res) => {
    if (!webhookSecret) {
      // Fail closed: never accept webhooks if no secret is configured.
      res.status(500).json({ error: 'server_misconfigured' });
      return;
    }

    const rawBody: unknown = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(415).json({ error: 'unsupported_media_type', expected: 'application/json' });
      return;
    }

    if (!verifySignature(rawBody, req.header(SIGNATURE_HEADER), webhookSecret)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }

    const parsed = parseBookingEvent(payload);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_payload', details: parsed.errors });
      return;
    }

    if (!events) {
      res.status(202).json({ status: 'accepted', eventId: parsed.data.id });
      return;
    }

    const eventId = parsed.data.id;

    // Redis check first: a repeated delivery is acknowledged without touching Postgres.
    // If Redis is down we fall through; the primary key in Postgres still prevents duplicates.
    let claimed = true;
    if (idempotency) {
      try {
        claimed = await idempotency.claim(eventId);
      } catch (err) {
        console.error('Idempotency store unavailable, falling back to Postgres:', err instanceof Error ? err.message : err);
      }
    }
    if (!claimed) {
      // 202 (not an error) so the sender stops retrying.
      res.status(202).json({ status: 'accepted', eventId, duplicate: true });
      return;
    }

    try {
      const { created, record } = await events.insertReceived(parsed.data);
      if (created) {
        dispatch?.(record.eventId);
      }
      res.status(202).json({ status: 'accepted', eventId: record.eventId, duplicate: !created });
    } catch (err) {
      console.error('Failed to store event', err);
      // Give the claim back, otherwise the sender's retry would be mistaken for a duplicate.
      await idempotency?.release(eventId).catch(() => undefined);
      res.status(500).json({ error: 'storage_error' });
    }
  });

  if (events) {
    const protect = requireApiKey(adminApiKey);

    app.get('/events', protect, async (req, res) => {
      const { status } = req.query;
      if (status !== undefined && !isStatus(status)) {
        res.status(400).json({ error: 'invalid_status' });
        return;
      }
      const limit = parseIntParam(req.query.limit, 50, 1, 200);
      const offset = parseIntParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      if (limit === null || offset === null) {
        res.status(400).json({ error: 'invalid_pagination' });
        return;
      }

      const { items, total } = await events.list({ status, limit, offset });
      res.json({ items, total, limit, offset });
    });

    // Registered before /events/:eventId so "stats" is not treated as an event id.
    app.get('/events/stats', protect, async (_req, res) => {
      res.json(await events.countByStatus());
    });

    app.get('/events/:eventId', protect, async (req, res) => {
      const record = await events.getById(String(req.params.eventId));
      if (!record) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(record);
    });

    // Manual replay of a failed event (used by the dashboard in Block 6).
    app.post('/events/:eventId/replay', protect, async (req, res) => {
      if (!dispatch) {
        res.status(503).json({ error: 'forwarding_not_configured' });
        return;
      }
      const record = await events.getById(String(req.params.eventId));
      if (!record) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (record.status !== 'failed') {
        res.status(409).json({ error: 'not_replayable', current: record.status });
        return;
      }
      dispatch(record.eventId);
      res.status(202).json({ status: 'replay_scheduled', eventId: record.eventId });
    });
  }

  return app;
}
