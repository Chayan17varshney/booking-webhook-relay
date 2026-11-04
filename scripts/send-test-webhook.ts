/**
 * Sends a correctly signed test booking webhook to a running instance.
 *
 *   WEBHOOK_SECRET=change-me npm run webhook:test
 *   WEBHOOK_SECRET=change-me npm run webhook:test -- http://localhost:3000 "12345"   (invalid phone)
 */
import crypto from 'node:crypto';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const phone = process.argv[3] ?? '+91 98765 43210';
const secret = process.env.WEBHOOK_SECRET;

if (!secret) {
  console.error('Set WEBHOOK_SECRET to the same value the server uses.');
  process.exit(1);
}

const body = JSON.stringify({
  id: `evt_${Date.now()}`,
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone },
  service: 'Discovery call',
  startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
});

const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

async function main() {
  const res = await fetch(`${baseUrl}/webhooks/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature },
    body,
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
