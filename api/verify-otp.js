const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, otp, phone } = req.body || {};
  if (!token || !otp || !phone || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const secret = process.env.OTP_SECRET || 'mtr-secret';

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'wrong' });
  }

  const { sig, phone: tokenPhone, expiry } = parsed;

  if (tokenPhone !== phone) return res.status(400).json({ error: 'wrong' });
  if (Date.now() > expiry)  return res.status(400).json({ error: 'OTP expired. Please resend.' });

  const expected = crypto.createHmac('sha256', secret).update(`${otp}:${phone}:${expiry}`).digest('hex');
  if (sig !== expected) return res.status(400).json({ error: 'wrong' });

  return res.status(200).json({ success: true });
};
