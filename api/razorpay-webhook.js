const crypto = require('crypto');
const { safeEqual, sendError } = require('../lib/security');
const { ORDER_ID } = require('../lib/razorpay');
const { finalizeOrder, rejectOrder } = require('../lib/orders');

const HANDLED_EVENTS = new Set(['payment.captured', 'payment.authorized', 'order.paid', 'payment.failed']);

// Razorpay signs the exact bytes it sends, so the raw body is needed (body parsing is switched off below).
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    if (req.body && typeof req.body === 'object' && req.readable === false) return resolve(Buffer.from(JSON.stringify(req.body)));
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Server-to-server: Razorpay tells us a payment succeeded, even if the customer closed the tab before the page confirmed it.
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook is not configured' });

  try {
    const raw = await readRawBody(req);
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!safeEqual(expected, String(req.headers['x-razorpay-signature'] || ''))) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid payload' }); }
    if (!HANDLED_EVENTS.has(event.event)) return res.status(200).json({ ok: true, ignored: event.event });

    const payload = event.payload || {};
    const orderId = (payload.payment && payload.payment.entity && payload.payment.entity.order_id)
      || (payload.order && payload.order.entity && payload.order.entity.id);
    if (!ORDER_ID.test(String(orderId || ''))) return res.status(200).json({ ok: true, ignored: 'no_order' });

    if (event.event === 'payment.failed') {
      // The customer may retry on the same order, in which case a later success upgrades this record to completed.
      const p = (payload.payment && payload.payment.entity) || {};
      const why = [p.error_description, p.error_reason].filter(Boolean).join(' - ') || 'The payment failed';
      const recorded = await rejectOrder(orderId, 'payment_failed', why);
      return res.status(200).json({ ok: true, recorded });
    }

    // Failures (database, Razorpay not yet consistent, ...) answer non-2xx so Razorpay retries later.
    const result = await finalizeOrder(orderId);
    if (!result.saved && result.reason === 'not_configured') return res.status(503).json({ error: 'Order storage is not configured' });
    return res.status(200).json({ ok: true, saved: result.saved, reason: result.reason || null });
  } catch (e) {
    return sendError(res, e);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
