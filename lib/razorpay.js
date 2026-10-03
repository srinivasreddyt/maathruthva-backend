const { HttpError } = require('./security');

function authHeader() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new HttpError(500, 'Server misconfigured');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function rz(method, path, body) {
  const headers = { Authorization: authHeader() };
  if (body) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(`https://api.razorpay.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new HttpError(502, 'Payment gateway unreachable');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, (data.error && data.error.description) || 'Payment gateway error');
  return data;
}

const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;

// Returns the Razorpay order only if it has a successful (captured/authorized) payment. Notes on it were set server-side.
async function getPaidOrder(orderId) {
  if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) throw new HttpError(400, 'Invalid order id');
  const [order, payments] = await Promise.all([
    rz('GET', `/v1/orders/${orderId}`),
    rz('GET', `/v1/orders/${orderId}/payments`),
  ]);
  const ok = (payments.items || []).some(p => p.status === 'captured' || p.status === 'authorized');
  if (!ok) throw new HttpError(402, 'No successful payment found for this order');
  return order;
}

module.exports = { rz, getPaidOrder, ORDER_ID };
