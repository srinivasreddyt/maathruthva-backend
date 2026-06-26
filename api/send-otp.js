const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone } = req.body || {};
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const secret     = process.env.OTP_SECRET || 'mtr-secret';

  if (!accountSid || !authToken || !fromNumber) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const otp    = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = Date.now() + 300000;
  const sig    = crypto.createHmac('sha256', secret).update(`${otp}:${phone}:${expiry}`).digest('hex');
  const token  = Buffer.from(JSON.stringify({ sig, phone, expiry })).toString('base64');

  const encoded = new URLSearchParams({
    To:   `+91${phone}`,
    From: fromNumber,
    Body: `${otp} is your OTP to login to Maathruthva. Valid for 5 minutes. Do not share with anyone.`,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      body: encoded,
    }
  );

  const data = await response.json();
  console.log('Twilio response:', JSON.stringify(data));

  if (data.sid) {
    return res.status(200).json({ success: true, token });
  } else {
    return res.status(502).json({ error: data.message || 'Failed to send OTP' });
  }
};
