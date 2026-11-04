import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

export const API_KEY_HEADER = 'x-api-key';

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

/**
 * Protects the read endpoints, which contain customer details.
 * Fails closed: if no key is configured the endpoints answer 500, never "open".
 * Both sides are hashed first so timingSafeEqual always compares equal-length buffers.
 */
export function requireApiKey(expectedKey: string): RequestHandler {
  return (req, res, next) => {
    if (!expectedKey) {
      res.status(500).json({ error: 'server_misconfigured' });
      return;
    }
    const provided = req.header(API_KEY_HEADER);
    if (!provided || !crypto.timingSafeEqual(sha256(provided), sha256(expectedKey))) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
