const crypto = require('crypto');

const DEFAULT_ORIGINS = ['https://www.maathruthva.com', 'https://maathruthva.com'];
const EXTRA_ORIGINS = (process.env.EXTRA_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Best-effort per-instance limiter (serverless instances do not share memory, so pair with Vercel Firewall rate limits).
const buckets = new Map();
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function overLimit(req, name, max, windowMs) {
  const now = Date.now();
  const key = name + ':' + clientIp(req);
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return b.count > max;
}

// Applies CORS, handles preflight, enforces POST and an optional per-IP limit. Returns true when the handler should continue.
function handle(req, res, limit) {
  const origin = req.headers.origin;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  if (limit && overLimit(req, limit.name, limit.max, limit.windowMs || 60000)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Too many requests, please slow down' });
    return false;
  }
  return true;
}

function getBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  if (typeof b === 'string') {
    try {
      const parsed = JSON.parse(b);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  return {};
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function isEmail(s) {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@<>"'`,;:\\()[\]]+@[^\s@<>"'`,;:\\()[\]]+\.[A-Za-z]{2,}$/.test(s.trim());
}

// Returns "91XXXXXXXXXX" (WhatsApp format) or null.
function normalizeIndianPhone(s) {
  if (typeof s !== 'string') return null;
  let d = s.replace(/[\s\-()+]/g, '');
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return '91' + d;
}

// Verifies a Firebase ID token (sent as "Authorization: Bearer <token>") belongs to an admin listed in ADMIN_EMAILS.
// While ADMIN_EMAILS is unset the check is not enforced, so existing admin tooling keeps working during rollout.
async function requireAdmin(req, strict = false) {
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) {
    if (strict) throw new HttpError(503, 'Admin access is not configured');
    return;
  }

  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Admin authentication required');

  const user = await lookupIdToken(m[1]);
  const email = user && String(user.email || '').toLowerCase();
  if (!email || !admins.includes(email)) throw new HttpError(403, 'Not an admin');
}

async function lookupIdToken(idToken) {
  const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyBWhNCWiT-us4L_J5ihcCiniisX1Jy9SoU';
  let r;
  try {
    r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    throw new HttpError(502, 'Could not verify session');
  }
  if (!r.ok) throw new HttpError(401, 'Invalid or expired session');
  const data = await r.json().catch(() => ({}));
  return (data.users && data.users[0]) || null;
}

// Optional login: returns { uid, email } for a valid "Authorization: Bearer <Firebase ID token>", null when no token is sent.
async function getVerifiedUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const user = await lookupIdToken(m[1]);
  if (!user || !user.localId) throw new HttpError(401, 'Invalid or expired session');
  return { uid: String(user.localId), email: String(user.email || '') };
}

function sendError(res, e) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  console.error('Unhandled error:', e && e.message);
  return res.status(500).json({ error: 'Internal error' });
}

module.exports = { HttpError, handle, getBody, escapeHtml, safeEqual, cleanText, isEmail, normalizeIndianPhone, requireAdmin, getVerifiedUser, sendError };
