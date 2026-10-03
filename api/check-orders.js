const { handle, getBody, requireAdmin, sendError, HttpError } = require('../lib/security');
const { rz, ORDER_ID } = require('../lib/razorpay');

const MAX_IDS = 40;
const CONCURRENCY = 5;

// notes.items looks like "FP01x2@333,FP03x1@349" (written by create-order).
function parseItems(notes) {
  const raw = notes && notes.items;
  if (typeof raw !== 'string' || !raw) return null;
  const items = [];
  for (const part of raw.split(',')) {
    const m = /^([A-Za-z0-9_-]+)x(\d+)@([\d.]+)$/.exec(part.trim());
    if (!m) return null;
    items.push({ productId: m[1], qty: Number(m[2]), price: Number(m[3]) });
  }
  return items;
}

async function checkOne(id) {
  try {
    const order = await rz('GET', `/v1/orders/${id}`);
    const orderPaise = Number(order.amount) || 0;
    let paidPaise = Number(order.amount_paid) || 0;
    let status = paidPaise > 0 && paidPaise >= orderPaise ? 'paid' : 'unpaid';

    if (status === 'unpaid') {
      const payments = await rz('GET', `/v1/orders/${id}/payments`);
      const ok = (payments.items || []).filter(p => p.status === 'captured' || p.status === 'authorized');
      if (ok.length) {
        paidPaise = ok.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        status = ok.some(p => p.status === 'captured') ? 'paid' : 'authorized';
      }
    }
    return { orderId: id, status, paidPaise, orderPaise, items: parseItems(order.notes) };
  } catch (e) {
    return { orderId: id, status: e && e.status === 404 ? 'notfound' : 'error' };
  }
}

// Admin-only: reports what Razorpay actually collected for each order id so the dashboard can flag orders whose
// saved total/items (written by the customer's browser) disagree with the real payment. No customer PII is returned.
module.exports = async (req, res) => {
  if (!handle(req, res, { name: 'check-orders', max: 30 })) return;
  try {
    await requireAdmin(req, true);
    const { orderIds } = getBody(req);
    if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.length > MAX_IDS) {
      throw new HttpError(400, `Provide between 1 and ${MAX_IDS} order ids`);
    }
    const ids = [...new Set(orderIds.filter(i => typeof i === 'string' && ORDER_ID.test(i)))];

    const results = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      results.push(...await Promise.all(ids.slice(i, i + CONCURRENCY).map(checkOne)));
    }
    res.status(200).json({ results });
  } catch (e) {
    sendError(res, e);
  }
};
