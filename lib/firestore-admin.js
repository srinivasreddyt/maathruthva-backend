const crypto = require('crypto');
const { HttpError } = require('./security');

// Minimal Firestore client authenticated as a service account (bypasses security rules, so it is only ever used by
// trusted server code). Configure FIREBASE_SERVICE_ACCOUNT with the downloaded key JSON (raw JSON or base64 of it).
const DB = 'https://firestore.googleapis.com/v1/projects/maathruthva/databases/(default)/documents';

function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const c = JSON.parse(text);
    return c.client_email && c.private_key ? c : null;
  } catch {
    return null;
  }
}

function isConfigured() {
  return !!credentials();
}

let cached = { value: '', exp: 0, who: '' };

async function accessToken() {
  const c = credentials();
  if (!c) throw new HttpError(503, 'Order storage is not configured');
  if (cached.value && cached.who === c.client_email && Date.now() < cached.exp - 60000) return cached.value;

  const now = Math.floor(Date.now() / 1000);
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: c.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(c.private_key).toString('base64url');

  let r;
  try {
    r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
  } catch {
    throw new HttpError(502, 'Could not reach Google to authorize');
  }
  if (!r.ok) throw new HttpError(502, 'Google rejected the service account');
  const j = await r.json();
  cached = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, who: c.client_email };
  return cached.value;
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = toValue(v);
  return fields;
}

function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}

async function request(method, url, body) {
  const token = await accessToken();
  try {
    return await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(502, 'Database unreachable');
  }
}

// Returns the document's data, or null when it does not exist.
async function getDocument(path) {
  const r = await request('GET', `${DB}/${path}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, 'Database read failed');
  return fromFields((await r.json()).fields);
}

// Creates a document with a fixed id. Returns false (without touching it) if it already exists.
async function createDocument(collectionPath, docId, data) {
  const r = await request('POST', `${DB}/${collectionPath}?documentId=${encodeURIComponent(docId)}`, { fields: toFields(data) });
  if (r.status === 409) return false;
  if (!r.ok) throw new HttpError(502, 'Database write failed');
  return true;
}

async function deleteDocument(path) {
  const r = await request('DELETE', `${DB}/${path}`);
  if (!r.ok && r.status !== 404) throw new HttpError(502, 'Database delete failed');
}

module.exports = { isConfigured, getDocument, createDocument, deleteDocument };
