import express from 'express';

export interface MockCrmOptions {
  apiKey?: string;
  /** Probability (0 to 1) that a request fails with HTTP 503, to exercise retries. */
  failRate?: number;
  random?: () => number;
}

/**
 * A stand-in CRM for local development and tests. It authenticates with a bearer key, rejects
 * invalid emails with 400, can randomly fail with 503, and de-duplicates on Idempotency-Key.
 */
export function createMockCrm(options: MockCrmOptions = {}) {
  const apiKey = options.apiKey ?? 'dev-crm-key';
  const failRate = options.failRate ?? 0;
  const random = options.random ?? Math.random;
  const contacts = new Map<string, { email: string; name: string }>();
  const app = express();
  app.use(express.json());

  app.post('/contacts', (req, res) => {
    if (req.header('authorization') !== `Bearer ${apiKey}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (random() < failRate) {
      res.status(503).json({ error: 'temporarily_unavailable' });
      return;
    }
    const { email, name } = (req.body ?? {}) as { email?: unknown; name?: unknown };
    if (typeof email !== 'string' || !email.includes('@') || typeof name !== 'string') {
      res.status(400).json({ error: 'invalid_contact' });
      return;
    }
    const key = req.header('idempotency-key') ?? email;
    if (contacts.has(key)) {
      res.status(200).json({ status: 'duplicate_ignored' });
      return;
    }
    contacts.set(key, { email, name });
    res.status(201).json({ status: 'created' });
  });

  // Count only, so the mock never prints customer details.
  app.get('/contacts/count', (_req, res) => {
    res.json({ count: contacts.size });
  });

  return app;
}
