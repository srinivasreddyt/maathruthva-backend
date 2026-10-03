const { HttpError } = require('./security');

const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/maathruthva/databases/(default)/documents';
const FREE_SHIPPING_ABOVE = 999;
const SHIPPING_FEE = 60;
const MAX_LINES = 20;
const MAX_QTY = 50;

function fsVal(v) {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  return undefined;
}

function truthy(v) {
  const x = fsVal(v);
  return x === true || x === 1;
}

async function fetchCatalog() {
  let r;
  try {
    r = await fetch(`${FIRESTORE}/Food_Products?pageSize=300`);
  } catch {
    throw new HttpError(502, 'Pricing service unavailable');
  }
  if (!r.ok) throw new HttpError(502, 'Pricing service unavailable');
  const j = await r.json();
  const catalog = {};
  for (const d of j.documents || []) {
    const f = d.fields || {};
    const id = fsVal(f.productId) || d.name.split('/').pop();
    catalog[id] = {
      productId: id,
      name: fsVal(f.name) || id,
      price: Number(fsVal(f.price)),
      available: truthy(f.isAvailable),
      // Missing isStockAvailable is treated as in stock; an explicit 0/false blocks the sale.
      inStock: f.isStockAvailable === undefined ? true : truthy(f.isStockAvailable),
    };
  }
  return catalog;
}

async function fetchPromo(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new HttpError(400, 'Invalid promo code');
  let r;
  try {
    r = await fetch(`${FIRESTORE}/promo_codes/${encodeURIComponent(code)}`);
  } catch {
    throw new HttpError(502, 'Pricing service unavailable');
  }
  if (r.status === 404) throw new HttpError(400, 'Invalid promo code');
  if (!r.ok) throw new HttpError(502, 'Pricing service unavailable');
  const f = (await r.json()).fields || {};
  const percent = Number(fsVal(f.percent));
  if (fsVal(f.active) !== true || !(percent > 0 && percent <= 100)) throw new HttpError(400, 'Invalid promo code');
  return { code, percent };
}

// Pure pricing: mirrors the checkout page maths (shipping on pre-discount subtotal, discount rounded to whole rupees).
function priceOrder(rawItems, catalog, promo) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_LINES) {
    throw new HttpError(400, 'Cart is empty or invalid');
  }
  const qtyById = new Map();
  for (const it of rawItems) {
    const id = it && typeof it.productId === 'string' ? it.productId : '';
    const qty = it && Number(it.qty);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new HttpError(400, 'Invalid cart item');
    }
    qtyById.set(id, Math.min(MAX_QTY, (qtyById.get(id) || 0) + qty));
  }

  const lines = [];
  let subtotal = 0;
  for (const [id, qty] of qtyById) {
    const p = catalog[id];
    if (!p || !p.available) throw new HttpError(400, 'A product in your cart is no longer available');
    if (!p.inStock) throw new HttpError(400, `${p.name} is out of stock`);
    if (!Number.isFinite(p.price) || p.price <= 0) throw new HttpError(502, 'Pricing service unavailable');
    lines.push({ productId: id, name: p.name, qty, price: p.price });
    subtotal += p.price * qty;
  }

  const discount = promo ? Math.round((subtotal * promo.percent) / 100) : 0;
  const shipping = subtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;
  const totalPaise = Math.round((subtotal - discount + shipping) * 100);
  if (totalPaise < 100) throw new HttpError(400, 'Order total is too low');

  return {
    items: lines,
    subtotal,
    discount,
    shipping,
    totalPaise,
    promoCode: promo ? promo.code : '',
  };
}

async function computeOrder({ items, promoCode }) {
  const [catalog, promo] = await Promise.all([fetchCatalog(), fetchPromo(promoCode)]);
  return priceOrder(items, catalog, promo);
}

module.exports = { computeOrder, priceOrder, fetchCatalog, fsVal };
